//! `<meta http-equiv="Content-Security-Policy">` in standalone HTML.
//!
//! A policy written for the multi-file site (`default-src 'self'`) blocks the
//! single-file output: the bundle becomes an inline `<script>`, the
//! stylesheet an inline `<style>`, and every asset a `data:` URL, and none of
//! those match `'self'`. The policy is rewritten with the narrowest
//! additions that let the inlined content load: one `'sha256-…'` source per
//! inline block, and `data:` for each kind of asset that became a data: URL.

use crate::mal_prelude::*;
use std::borrow::Cow;
use std::io::Write as _;

use bstr::BStr;
use bun_core::strings;

use crate::chunk::{Content, CssImportOrderKind, IntermediateOutput};
use crate::{Chunk, CompileResult, LinkerContext};

/// ASCII whitespace as CSP defines it (https://w3c.github.io/webappsec-csp/#grammardef-optional-ascii-whitespace).
const WHITESPACE: &[u8] = b" \t\n\x0c\r";

/// Rewrites the `content` of every `<meta http-equiv="Content-Security-Policy">`
/// that `HTMLLoader` recorded for the standalone HTML document `chunks[html]`,
/// now that the contents of the chunks inlined into it are final, and adds
/// a note to the log for each policy that changed. Returns `None` when the
/// document has no such tag.
pub(crate) fn resolve_for_html_chunk(
    c: &LinkerContext<'_>,
    html: usize,
    chunks: &[Chunk],
    standalone_chunk_contents: &[Option<Box<[u8]>>],
) -> Option<Box<[Box<[u8]>]>> {
    let chunk = &chunks[html];
    let Some(CompileResult::Html {
        content_security_policies,
        ..
    }) = chunk.compile_results_for_chunk.iter().next()
    else {
        return None;
    };
    if content_security_policies.is_empty() {
        return None;
    }

    let js_chunk = chunk.get_js_chunk_index_for_html(chunks);
    let css_chunk = chunk.get_css_chunk_index_for_html(chunks);

    // The inline `<script>` / `<style>` this document gets for each chunk
    // (see `HTMLLoader::standalone_body_script` / `get_head_tags`). A browser
    // returns before the CSP check for an empty script, so that needs no hash.
    let inline_block_hash = |index: Option<usize>| -> Option<HashSource> {
        let index = index?;
        let content = standalone_chunk_contents[index].as_deref()?;
        if content.is_empty() {
            return None;
        }
        Some(hash_source(
            &IntermediateOutput::sha256_escaping_closing_tags(
                content,
                chunks[index].closing_tag_for_content(),
            ),
        ))
    };
    let scripts: Vec<HashSource> = inline_block_hash(js_chunk).into_iter().collect();
    let styles: Vec<HashSource> = inline_block_hash(css_chunk).into_iter().collect();

    // Every reference this document, its bundle and its stylesheet make to a
    // file that standalone mode turns into a data: URL.
    let parse_graph = c.parse_graph();
    let loaders = parse_graph.input_files.items_loader();
    let urls_for_css = parse_graph.ast.items_url_for_css();
    let import_records = c.graph.ast.items_import_records();
    let mut data_urls = DataUrlKinds::default();
    let mut visit = |source_index: u32, importer_is_js: bool| {
        let Some(records) = import_records.get(source_index as usize) else {
            return;
        };
        for record in records.as_slice() {
            if record.source_index.is_invalid() {
                continue;
            }
            let target = record.source_index.get() as usize;
            let url = urls_for_css[target];
            if url.is_empty() {
                continue;
            }
            let loader = loaders[target];
            // JS only sees a URL for file-loader imports; HTML attributes and
            // CSS `url()` take the data: URL of anything that is not code.
            let becomes_data_url = if importer_is_js {
                loader.should_copy_for_bundling()
            } else {
                !(loader.is_javascript_like() || loader.is_css())
            };
            if becomes_data_url {
                data_urls.add_data_url(url);
            }
        }
    };
    visit(chunk.entry_point.source_index(), false);
    if let Some(Content::Javascript(js)) = js_chunk.map(|i| &chunks[i].content) {
        for &source_index in js.files_in_chunk_order.iter() {
            visit(source_index, true);
        }
    }
    if let Some(Content::Css(css)) = css_chunk.map(|i| &chunks[i].content) {
        for order in css.imports_in_chunk_in_order.iter() {
            if let CssImportOrderKind::SourceIndex(source_index) = &order.kind {
                visit(source_index.get(), false);
            }
        }
    }

    let inlined = InlinedContent {
        scripts: &scripts,
        styles: &styles,
        data_urls,
    };
    let pretty_path = parse_graph.input_files.items_source()
        [chunk.entry_point.source_index() as usize]
        .path
        .pretty;
    let resolved = content_security_policies
        .iter()
        .map(|value| {
            // `value` is the attribute as written, character references
            // included. The browser parses the decoded text.
            let Some(rewrite) = rewrite(&decode_character_references(value), &inlined) else {
                return value.clone();
            };

            let mut note: Vec<u8> = Vec::new();
            write!(
                &mut note,
                "{}: added {} in its <meta http-equiv=\"Content-Security-Policy\"> for the content this build inlined",
                BStr::new(pretty_path),
                BStr::new(&rewrite.summary),
            )
            .ok();
            c.log_disjoint().add_msg(bun_ast::Msg {
                kind: bun_ast::Kind::Note,
                data: bun_ast::Data {
                    text: Cow::Owned(note),
                    ..Default::default()
                },
                ..Default::default()
            });

            let mut out = Vec::with_capacity(rewrite.policy.len() + 16);
            for &byte in rewrite.policy.iter() {
                match byte {
                    b'&' => out.extend_from_slice(b"&amp;"),
                    b'"' => out.extend_from_slice(b"&quot;"),
                    _ => out.push(byte),
                }
            }
            out.into_boxed_slice()
        })
        .collect();
    Some(resolved)
}

/// `raw` with its `&…;` character references decoded.
fn decode_character_references(raw: &[u8]) -> Cow<'_, [u8]> {
    let Some(first) = strings::index_of_char_usize(raw, b'&') else {
        return Cow::Borrowed(raw);
    };
    let mut out = Vec::with_capacity(raw.len());
    out.extend_from_slice(&raw[..first]);
    let mut rest = &raw[first..];
    let mut utf8 = [0u8; 8];
    while !rest.is_empty() {
        // `rest` starts with `&`.
        let reference_len = rest[1..]
            .iter()
            .take(48)
            .position(|&b| !(b.is_ascii_alphanumeric() || b == b'#'))
            .map(|name_len| name_len + 2)
            .filter(|&len| len > 2 && rest[len - 1] == b';');
        match reference_len
            .and_then(|len| bun_md::helpers::decode_entity_to_utf8(&rest[..len], &mut utf8))
        {
            Some(decoded) => {
                out.extend_from_slice(decoded);
                rest = &rest[reference_len.unwrap()..];
            }
            None => {
                out.push(b'&');
                rest = &rest[1..];
            }
        }
        let next = strings::index_of_char_usize(rest, b'&').unwrap_or(rest.len());
        out.extend_from_slice(&rest[..next]);
        rest = &rest[next..];
    }
    Cow::Owned(out)
}

/// `'sha256-` + 44 base64 chars + `'`.
const HASH_SOURCE_LEN: usize = 8 + 44 + 1;
type HashSource = [u8; HASH_SOURCE_LEN];

fn hash_source(digest: &[u8; 32]) -> HashSource {
    let mut out = [0u8; HASH_SOURCE_LEN];
    out[..8].copy_from_slice(b"'sha256-");
    let n = bun_base64::encode(&mut out[8..8 + 44], digest);
    debug_assert_eq!(n, 44);
    out[HASH_SOURCE_LEN - 1] = b'\'';
    out
}

/// Which fetch directives the inlined `data:` URLs fall under.
#[derive(Clone, Copy, Default)]
struct DataUrlKinds {
    /// `img-src`: `<img>`, icons, posters, CSS images.
    image: bool,
    /// `font-src`
    font: bool,
    /// `media-src`: `<video>`, `<audio>`, `<source>`.
    media: bool,
    /// `manifest-src`: `<link rel="manifest">`.
    manifest: bool,
}

impl DataUrlKinds {
    /// Classifies one `data:<mime>;base64,…` URL by its MIME type.
    fn add_data_url(&mut self, url: &[u8]) {
        let Some(rest) = url.strip_prefix(b"data:".as_slice()) else {
            return;
        };
        if rest.starts_with(b"image/") {
            self.image = true;
        } else if rest.starts_with(b"font/")
            || rest.starts_with(b"application/font-")
            || rest.starts_with(b"application/x-font-")
            || rest.starts_with(b"application/vnd.ms-fontobject")
        {
            self.font = true;
        } else if rest.starts_with(b"video/") || rest.starts_with(b"audio/") {
            self.media = true;
        } else if rest.starts_with(b"application/manifest+json") {
            self.manifest = true;
        }
    }

    fn any(&self) -> bool {
        self.image || self.font || self.media || self.manifest
    }
}

/// What the standalone document inlines, as CSP source expressions.
struct InlinedContent<'a> {
    /// One hash per inline `<script>` block, in document order.
    scripts: &'a [HashSource],
    /// One hash per inline `<style>` block.
    styles: &'a [HashSource],
    data_urls: DataUrlKinds,
}

struct Directive<'a> {
    /// The directive as written, without surrounding whitespace.
    raw: &'a [u8],
    name: &'a [u8],
    /// Source list text after the name, trimmed.
    value: &'a [u8],
}

impl<'a> Directive<'a> {
    fn parse(raw: &'a [u8]) -> Option<Self> {
        let raw = strings::trim(raw, WHITESPACE);
        if raw.is_empty() {
            return None;
        }
        let name_end = strings::index_of_any(raw, WHITESPACE).unwrap_or(raw.len());
        Some(Directive {
            raw,
            name: &raw[..name_end],
            value: strings::trim(&raw[name_end..], WHITESPACE),
        })
    }

    fn sources(&self) -> impl Iterator<Item = &'a [u8]> {
        strings::tokenize_any(self.value, WHITESPACE)
    }

    fn has_source(&self, source: &[u8]) -> bool {
        self.sources()
            .any(|s| strings::eql_case_insensitive_ascii_check_length(s, source))
    }

    fn is_none(&self) -> bool {
        let mut sources = self.sources();
        matches!(sources.next(), Some(s) if strings::eql_case_insensitive_ascii_check_length(s, b"'none'"))
            && sources.next().is_none()
    }

    /// A nonce or hash in the list makes browsers ignore `'unsafe-inline'`.
    fn has_nonce_or_hash(&self) -> bool {
        self.sources().any(|s| {
            strings::starts_with_case_insensitive_ascii(s, b"'nonce-")
                || strings::starts_with_case_insensitive_ascii(s, b"'sha256-")
                || strings::starts_with_case_insensitive_ascii(s, b"'sha384-")
                || strings::starts_with_case_insensitive_ascii(s, b"'sha512-")
        })
    }

    fn allows_inline(&self) -> bool {
        self.has_source(b"'unsafe-inline'") && !self.has_nonce_or_hash()
    }
}

#[derive(Clone, Copy)]
enum Need<'a> {
    /// Inline `<script>` / `<style>` blocks with these hashes.
    Inline(&'a [HashSource]),
    /// `data:` URLs.
    Data,
}

struct Rewrite {
    policy: Vec<u8>,
    /// "<sources> to <directive>, …" for the build note.
    summary: Vec<u8>,
}

/// Returns the rewritten policy, or `None` when `policy` already allows
/// everything in `inlined` (or blocks it on purpose with `'none'`).
fn rewrite(policy: &[u8], inlined: &InlinedContent<'_>) -> Option<Rewrite> {
    if inlined.scripts.is_empty() && inlined.styles.is_empty() && !inlined.data_urls.any() {
        return None;
    }

    let directives: Vec<Directive<'_>> = strings::split(policy, b";")
        .filter_map(Directive::parse)
        .collect();
    // Per the spec a repeated directive name is ignored after its first use.
    let find = |name: &[u8]| -> Option<usize> {
        directives
            .iter()
            .position(|d| strings::eql_case_insensitive_ascii_check_length(d.name, name))
    };

    // Sources to add to an existing directive, indexed like `directives`.
    let mut additions: Vec<Vec<u8>> = (0..directives.len()).map(|_| Vec::new()).collect();
    // New directives, each split off the fallback that governs it today.
    let mut appended: Vec<u8> = Vec::new();
    let mut summary: Vec<u8> = Vec::new();

    // (directive, its fallbacks, what it must allow). `*-src-elem` (CSP3)
    // takes precedence over `*-src` in browsers that know it, so when a page
    // uses it the hash goes there too, but it is never introduced.
    // https://w3c.github.io/webappsec-csp/#directive-fallback-list
    const DEFAULT_SRC: &[&[u8]] = &[b"default-src"];
    let kinds = inlined.data_urls;
    let needs: [(&[u8], &[&[u8]], Need<'_>, bool); 8] = [
        (b"script-src-elem", &[], Need::Inline(inlined.scripts), true),
        (
            b"script-src",
            DEFAULT_SRC,
            Need::Inline(inlined.scripts),
            true,
        ),
        (b"style-src-elem", &[], Need::Inline(inlined.styles), true),
        (
            b"style-src",
            DEFAULT_SRC,
            Need::Inline(inlined.styles),
            true,
        ),
        (b"img-src", DEFAULT_SRC, Need::Data, kinds.image),
        (b"font-src", DEFAULT_SRC, Need::Data, kinds.font),
        (b"media-src", DEFAULT_SRC, Need::Data, kinds.media),
        (b"manifest-src", DEFAULT_SRC, Need::Data, kinds.manifest),
    ];

    for (name, fallbacks, need, present) in needs {
        if !present {
            continue;
        }
        let own = find(name);
        // The directive that governs this kind of content today.
        let Some(index) = own.or_else(|| fallbacks.iter().find_map(|f| find(f))) else {
            // Nothing restricts it.
            continue;
        };
        let effective = &directives[index];
        if effective.is_none() {
            // `'none'` blocked this content on the multi-file site too.
            continue;
        }

        let mut sources: Vec<u8> = Vec::new();
        match need {
            Need::Inline(hashes) => {
                if effective.allows_inline() {
                    continue;
                }
                for hash in hashes {
                    if !effective.has_source(hash) {
                        sources.push(b' ');
                        sources.extend_from_slice(hash);
                    }
                }
            }
            Need::Data => {
                if !effective.has_source(b"data:") {
                    sources.extend_from_slice(b" data:");
                }
            }
        }
        if sources.is_empty() {
            continue;
        }
        if !summary.is_empty() {
            summary.extend_from_slice(b", ");
        }
        summary.extend_from_slice(&sources[1..]);
        summary.extend_from_slice(b" to ");
        summary.extend_from_slice(name);

        if own.is_some() {
            additions[index].extend_from_slice(&sources);
            continue;
        }
        // Split a dedicated directive off the fallback so the fallback, and
        // everything else that inherits it, stays as written.
        appended.extend_from_slice(b"; ");
        appended.extend_from_slice(name);
        for source in effective.sources() {
            // Keywords other than 'self', nonces and hashes only mean
            // something to scripts and styles.
            if matches!(need, Need::Data)
                && source.starts_with(b"'")
                && !strings::eql_case_insensitive_ascii_check_length(source, b"'self'")
            {
                continue;
            }
            appended.push(b' ');
            appended.extend_from_slice(source);
        }
        appended.extend_from_slice(&sources);
    }

    if summary.is_empty() {
        return None;
    }

    let mut out: Vec<u8> = Vec::with_capacity(policy.len() + appended.len() + 2 * HASH_SOURCE_LEN);
    for (i, directive) in directives.iter().enumerate() {
        if i > 0 {
            out.extend_from_slice(b"; ");
        }
        out.extend_from_slice(directive.raw);
        out.extend_from_slice(&additions[i]);
    }
    // Something was restricted, so there is at least one directive for
    // `appended`'s leading "; " to follow.
    out.extend_from_slice(&appended);
    Some(Rewrite {
        policy: out,
        summary,
    })
}
