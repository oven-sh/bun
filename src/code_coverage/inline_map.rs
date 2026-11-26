use core::ops::Range;

use bun_ast::{ExprData, Log, Source, StoreResetGuard};
use bun_core::strings;
use bun_parsers::json::ParsedJson;
use bun_paths::Path;
use bun_resolver::data_url::DataURL;
use bun_sourcemap::LineColumnOffset;
use bun_sourcemap::mapping::{self, List, ParseOptions};

use crate::files::{is_file, read_if_file};
use crate::filter::{Filter, real_path, without_query};
use crate::hints::is_in_word;
use crate::positions::Positions;

/// The source map that a plugin appends to the code that it makes of a file. Any tool can have written it.
pub(crate) struct InlineMap {
    pub(crate) file: Vec<u8>,
    mappings: Vec<Mapping>,
}

pub(crate) struct DoesNotFit;

/// In bytes, from the start of the text around it that the code and the file have in common.
struct Mapping {
    line_of_code: Range<u32>,
    code: u32,
    /// With the rest of the line. `None` for another source.
    file: Option<(u32, u32)>,
    same: u32,
    /// Also to the start of what the tool has put in place of a token: `(0, a.b)`.
    reach: u32,
}

struct Parsed {
    mappings: List,
    /// By the index in the map.
    are_file: Vec<bool>,
    /// What the tool was given, which another can have changed before.
    file: Option<Vec<u8>>,
}

/// In the comments that `text` ends with.
fn find_url(mut text: &[u8]) -> Option<&[u8]> {
    loop {
        text = text.trim_ascii_end();
        let (rest, line) = text.split_at(strings::last_index_of_char(text, b'\n').unwrap_or(0));
        let comment = line.trim_ascii_start().strip_prefix(b"//")?;
        if let Some(url) = comment.strip_prefix(b"# sourceMappingURL=") {
            let ends_template = strings::contains_char(url, b'`');
            return (url.starts_with(b"data:") && !ends_template).then_some(url);
        }
        text = rest;
    }
}

/// `None` if it is the name of no file.
fn is_name_of(path: &[u8], name: &[u8], filter: &Filter) -> Option<bool> {
    let find = |path: &[u8]| Some(is_file(path).then(|| real_path(path))??.to_vec());
    let found = [bun_paths::dirname_or_root(path), filter.root()]
        .map(|start| find(&Path::resolve(&[start, name])));
    (found != [None, None]).then(|| found.contains(&find(path)))
}

/// `None` also if it has code of other files of the project.
fn parse(url: &[u8], path: &[u8], file: &[u8], filter: &Filter) -> Option<Parsed> {
    let json = DataURL::parse_without_check(url).ok()?.decode_data().ok()?;
    bun_ast::initialize_store();
    let _store = StoreResetGuard::new();
    let source = Source::init_path_string("sourcemap.json", &*json);
    let json = ParsedJson::parse_json(&source, &mut Log::init()).ok()?;
    let [names, texts] = [&b"sources"[..], b"sourcesContent"].map(|key| {
        let ExprData::EArrayJSON(array) = json.root.get(key)?.data else {
            return None;
        };
        Some(array)
    });
    let names = names.iter().flat_map(|it| it.get().items());
    let names = names.map(|it| it.as_str().unwrap_or_default());
    let text = |index: usize| texts.as_ref()?.get().items().get(index)?.as_str();
    let are_file: Vec<_> = (names.clone())
        .map(|it| !filter.is_dependency(it) && !it.starts_with(b"<define:"))
        .collect();
    let mut sources = names.enumerate().filter(|it| are_file[it.0]);
    let (first, is_alone) = (sources.clone().next(), sources.clone().count() == 1);
    if !sources.all(|(index, name)| {
        text(index) == Some(file) || is_name_of(path, name, filter).unwrap_or(is_alone)
    }) {
        return None;
    }
    let (mappings, allow_names, sort) = (json.root.get(b"mappings")?, false, true);
    let map = mapping::parse(
        mappings.as_utf8_string_literal()?,
        None,
        are_file.len() as i32,
        ParseOptions { allow_names, sort },
    );
    Some(Parsed {
        mappings: map.ok()?.mappings,
        file: first.and_then(|it| text(it.0)).map(Vec::from),
        are_file,
    })
}

/// `None` if `file` is too short.
fn convert(map: Parsed, code: &[u8], file: Vec<u8>) -> Option<InlineMap> {
    let lines = Positions::new(&file).line_count();
    let (list, file) = (map.mappings, map.file.unwrap_or(file));
    let (in_code, in_file) = (Positions::new(code), Positions::new(&file));
    let pair = |it: &LineColumnOffset| (it.lines.zero_based() as _, it.columns.zero_based() as _);
    let mut starts = (list.generated().iter().map(pair))
        .map(|it| (in_code.line(it.0), in_code.token_at(it)))
        .map(|(line, it)| (it.min(line.end), line))
        .peekable();
    let (mut all, mut last) = (Vec::<Mapping>::with_capacity(starts.len()), None);
    for (to, &source) in list.original().iter().map(pair).zip(list.source_index()) {
        let to = map.are_file.get(source as usize)?.then_some(to);
        if to.is_some_and(|it| it.0 >= lines.min(in_file.line_count())) {
            return None;
        }
        let to = to.map(|it| in_file.token_at(it));
        let to = to.map(|it| (it, in_file.line(in_file.line_of(it)).end));
        let (from, line) = starts.next()?;
        let next = starts.peek().map_or(u32::MAX, |it| it.0);
        let taken = all.last().map_or(0, |it| it.code + it.reach);
        let before = code.get(taken.max(line.start) as usize..from as usize)?;
        let after = code.get(from as usize..next.min(line.end) as usize)?;
        let file = file.split_at(to.unwrap_or_default().0 as usize);
        let is_same = |it: &(&u8, &u8)| it.0 == it.1;
        let back = before.iter().rev().zip(file.0.iter().rev());
        let back = &before[before.len() - back.take_while(is_same).count()..];
        let back = back.trim_ascii_start().len() as u32;
        let on = after.iter().zip(file.1).take_while(is_same).count() as u32;
        // `tsc` and Babel map the ends of nodes too, and Babel maps what it adds to the last of them.
        let is_start = core::mem::replace(&mut last, to) != to
            && to.is_some_and(|it| it.0 < it.1)
            && !matches!(after, [b')' | b']' | b'}' | b'>', ..]);
        let start = after.len() + 1 - strings::trim_left(after, b"(").len().max(1);
        all.push(Mapping {
            line_of_code: line,
            code: from - back,
            file: to.map(|it| (it.0 - back, it.1)),
            same: back + on,
            reach: back + on.max(if is_start { start as u32 } else { 0 }),
        });
    }
    let mappings = all;
    Some(InlineMap { file, mappings })
}

impl InlineMap {
    pub(crate) fn find(
        path: &[u8],
        code: &[u8],
        filter: &Filter,
    ) -> Option<Result<InlineMap, DoesNotFit>> {
        let (url, path) = (find_url(code)?, without_query(path));
        let file = read_if_file(path).filter(|it| find_url(it).is_none())?;
        let map = parse(url, path, &file, filter).and_then(|it| convert(it, code, file));
        Some(map.ok_or(DoesNotFit))
    }

    fn up_to(&self, code: u32) -> &[Mapping] {
        &self.mappings[..self.mappings.partition_point(|it| it.code <= code)]
    }

    fn rest_of_line(&self, mapping: &Mapping, code: u32) -> Option<(u32, u32)> {
        let (start, end) = mapping.file?;
        let start = start + (code - mapping.code).min(mapping.same);
        ((start as usize) < self.file.len()).then(|| (start, end.max(start + 1)))
    }

    /// With the rest of the line. `None` if it is not from the file.
    pub(crate) fn token(&self, code: u32) -> Option<(u32, u32)> {
        let mapping = self.up_to(code).last();
        self.rest_of_line(mapping.filter(|it| code - it.code < it.reach)?, code)
    }

    fn near(&self, mapping: &Mapping, code: u32) -> Option<(u32, u32)> {
        (mapping.line_of_code.contains(&code)).then(|| self.rest_of_line(mapping, mapping.code))?
    }

    /// On the first line.
    pub(crate) fn first_token_in(&self, (start, end): (u32, u32)) -> Option<(u32, u32)> {
        self.token(start).or_else(|| {
            let next = self.mappings.get(self.up_to(start).len());
            self.near(next.filter(|it| it.code < end)?, start)
        })
    }

    /// Of what starts with `head`. `None` if nothing on the line is from the file up to there.
    pub(crate) fn range(&self, head: (u32, u32), end: u32) -> Option<(u32, u32)> {
        let (start, end_of_line) = (self.first_token_in(head))
            .or_else(|| self.near(self.up_to(head.0).last()?, head.0))?;
        let last = self.up_to(end.saturating_sub(1)).last()?;
        let end = (last.file).map(|(from, _)| match end - last.code {
            length if length <= last.same => from + length,
            _ => {
                let rest = self.file[(from + last.same) as usize..].iter();
                from + last.same + rest.take_while(|&&it| is_in_word(it)).count() as u32
            }
        });
        Some((start, end.filter(|&it| it > start).unwrap_or(end_of_line)))
    }
}
