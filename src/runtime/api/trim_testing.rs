use bun_core::printer::json_stringify;
use bun_core::slice_to_nul;
use bun_exe_format::builtins::Image;
use bun_exe_format::image::{ExecutableFormat, read_bytes_at};
use bun_exe_format::macho::MachoFile;
use bun_jsc::bindgen::JsScope;
use bun_jsc::{JSGlobalObject, JsError, JsResult};
use bun_options_types::trim::TrimRequest;
use bun_sys::{Fd, File, O};
use bun_trim::table::{
    self, IcuItemRun, IcuLanguage, IcuPackage, ModuleText, RemovableRange, TrimTable,
};
use bun_trim::{
    ExecutableSettings, Feature, FeatureEdge, TrimError, TrimInput, TrimSummary, UsedFeatures,
    apply, plan,
};

pub(crate) fn trim_executable(
    cx: &mut JsScope<'_>,
    path: &[u8],
    out: &[u8],
    feature_names: &[u8],
) -> JsResult<Vec<u8>> {
    let global = cx.global();
    let features = parse_feature_names(global, feature_names)?;
    let mut bytes = read_executable(global, path)?;

    let request = TrimRequest {
        remove_internal: features,
        ..Default::default()
    };
    let summary = trim_in_memory(global, &mut bytes, &UsedFeatures::default(), &request)?;

    if summary.format == Some(ExecutableFormat::MachO) {
        bytes =
            sign_macho(&bytes).map_err(|error| global.throw(format_args!("{}", error.name())))?;
    }
    write_executable(out, &bytes).map_err(|error| global.throw(format_args!("{error}")))?;

    Ok(describe_summary(&summary))
}

pub(crate) fn read_trim_table(cx: &mut JsScope<'_>, path: &[u8]) -> JsResult<Vec<u8>> {
    let global = cx.global();
    let bytes = read_executable(global, path)?;
    let trim_table = table::read_trim_table(&mut Image {
        len: bytes.len(),
        read: &mut image_over(&bytes),
    })
    .map_err(|error| throw_trim_error(global, &error))?;

    Ok(describe_table(&trim_table))
}

fn trim_in_memory(
    global: &JSGlobalObject,
    bytes: &mut Vec<u8>,
    used: &UsedFeatures,
    request: &TrimRequest,
) -> JsResult<TrimSummary> {
    let settings = ExecutableSettings::default();
    let trim_plan = plan(
        &TrimInput {
            used,
            settings: &settings,
            request,
        },
        &mut Image {
            len: bytes.len(),
            read: &mut image_over(bytes),
        },
    )
    .map_err(|error| throw_trim_error(global, &error))?;
    apply(bytes, &trim_plan).map_err(|error| throw_trim_error(global, &error))
}

fn parse_feature_names(global: &JSGlobalObject, names: &[u8]) -> JsResult<Vec<Feature>> {
    bun_core::strings::split(names, b"\n")
        .filter(|name| !name.is_empty())
        .map(|name| {
            Feature::from_name(name).ok_or_else(|| {
                global.throw(format_args!(
                    "unknown feature \"{}\"",
                    bstr::BStr::new(name)
                ))
            })
        })
        .collect()
}

fn read_executable(global: &JSGlobalObject, path: &[u8]) -> JsResult<Vec<u8>> {
    File::read_from(Fd::cwd(), path).map_err(|error| global.throw(format_args!("{error}")))
}

fn write_executable(path: &[u8], bytes: &[u8]) -> bun_sys::Maybe<()> {
    File::openat(Fd::cwd(), path, O::WRONLY | O::CREAT | O::TRUNC, 0o755)?.write_all(bytes)
}

fn sign_macho(bytes: &[u8]) -> bun_exe_format::Result<Vec<u8>> {
    let mut file = MachoFile::init(bytes, 0)?;
    let mut signed = Vec::new();
    let written = file.build_and_sign(&mut signed)?;
    signed.truncate(written);
    Ok(signed)
}

fn image_over(bytes: &[u8]) -> impl FnMut(usize, &mut [u8]) -> bool + '_ {
    move |offset, buffer| read_bytes_at(bytes, offset, buffer)
}

fn throw_trim_error(global: &JSGlobalObject, error: &TrimError) -> JsError {
    let mut message = Vec::new();
    error.write_message(&mut message);
    global.throw(format_args!("{}", bstr::BStr::new(&message)))
}

fn write_number(out: &mut Vec<u8>, number: u64) {
    out.extend_from_slice(number.to_string().as_bytes());
}

fn write_boolean(out: &mut Vec<u8>, value: bool) {
    out.extend_from_slice(if value { b"true" } else { b"false" });
}

fn write_array<T>(
    out: &mut Vec<u8>,
    items: impl IntoIterator<Item = T>,
    mut write_item: impl FnMut(&mut Vec<u8>, T),
) {
    out.push(b'[');
    for (position, item) in items.into_iter().enumerate() {
        if position > 0 {
            out.push(b',');
        }
        write_item(out, item);
    }
    out.push(b']');
}

fn write_feature_index(out: &mut Vec<u8>, feature: Feature) {
    write_number(out, u64::from(feature.index()));
}

#[allow(clippy::trivially_copy_pass_by_ref)] // what `write_array` calls
fn write_edge(out: &mut Vec<u8>, edge: &FeatureEdge) {
    out.extend_from_slice(b"{\"from\":");
    write_feature_index(out, edge.from);
    out.extend_from_slice(b",\"to\":");
    write_feature_index(out, edge.to);
    out.extend_from_slice(b",\"strength\":");
    json_stringify(format!("{:?}", edge.strength).as_bytes(), out);
    out.extend_from_slice(b",\"isFollowed\":");
    write_boolean(out, edge.is_followed);
    out.push(b'}');
}

fn write_range(out: &mut Vec<u8>, range: &RemovableRange) {
    out.extend_from_slice(b"{\"start\":");
    write_number(out, range.range.start);
    out.extend_from_slice(b",\"end\":");
    write_number(out, range.range.end);
    out.extend_from_slice(b",\"set\":");
    write_number(out, u64::from(range.set.0));
    out.extend_from_slice(b",\"isCode\":");
    write_boolean(out, range.is_code);
    out.extend_from_slice(b",\"canBeCut\":");
    write_boolean(out, range.can_be_cut);
    out.extend_from_slice(b",\"canBeFilled\":");
    write_boolean(out, range.can_be_filled);
    out.push(b'}');
}

fn write_icu_run(out: &mut Vec<u8>, run: &IcuItemRun) {
    out.extend_from_slice(b"{\"firstItem\":");
    write_number(out, u64::from(run.first_item));
    out.extend_from_slice(b",\"itemCount\":");
    write_number(out, u64::from(run.item_count));
    out.extend_from_slice(b",\"set\":");
    write_number(out, u64::from(run.set.0));
    if let Some(group) = run.locale_group {
        out.extend_from_slice(b",\"localeGroup\":");
        write_number(out, u64::from(group.0));
    }
    out.push(b'}');
}

fn write_icu_package(out: &mut Vec<u8>, package: &IcuPackage) {
    out.extend_from_slice(b"{\"start\":");
    write_number(out, package.range.start);
    out.extend_from_slice(b",\"end\":");
    write_number(out, package.range.end);
    out.extend_from_slice(b",\"runs\":");
    write_array(out, &package.runs, write_icu_run);
    out.push(b'}');
}

#[allow(clippy::trivially_copy_pass_by_ref)] // what `write_array` calls
fn write_icu_language(out: &mut Vec<u8>, language: &IcuLanguage) {
    out.extend_from_slice(b"{\"name\":");
    json_stringify(slice_to_nul(&language.name), out);
    out.extend_from_slice(b",\"group\":");
    write_number(out, u64::from(language.group.0));
    out.push(b'}');
}

fn write_module_text(out: &mut Vec<u8>, text: &ModuleText) {
    out.extend_from_slice(b"{\"start\":");
    write_number(out, text.range.start);
    out.extend_from_slice(b",\"end\":");
    write_number(out, text.range.end);
    out.extend_from_slice(b",\"module\":");
    write_number(out, u64::from(text.module));
    out.extend_from_slice(b",\"set\":");
    write_number(out, u64::from(text.set.0));
    if let Some(readers) = text.readers {
        out.extend_from_slice(b",\"readers\":");
        write_number(out, u64::from(readers.0));
    }
    out.extend_from_slice(b",\"canBeCut\":");
    write_boolean(out, text.can_be_cut);
    out.extend_from_slice(b",\"canBeFilled\":");
    write_boolean(out, text.can_be_filled);
    out.push(b'}');
}

fn describe_summary(summary: &TrimSummary) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"{\"removed\":");
    write_array(&mut out, summary.removed.iter(), |out, feature| {
        json_stringify(feature.name().as_bytes(), out);
    });
    out.extend_from_slice(b",\"removedBytes\":");
    write_number(&mut out, summary.removed_bytes());
    out.extend_from_slice(b",\"fileBytesSaved\":");
    write_number(&mut out, summary.file_bytes_saved);
    out.extend_from_slice(b",\"uncutReason\":");
    match summary.uncut {
        Some(uncut) => json_stringify(uncut.reason.name().as_bytes(), &mut out),
        None => out.extend_from_slice(b"null"),
    }
    out.push(b'}');
    out
}

fn describe_table(table: &TrimTable) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"{\"featuresHash\":\"");
    write_number(&mut out, table.features_hash);
    out.extend_from_slice(b"\",\"baseAddress\":");
    write_number(&mut out, table.base_address);
    out.extend_from_slice(b",\"edges\":");
    write_array(&mut out, table.edges.as_slice(), write_edge);
    out.extend_from_slice(b",\"sets\":");
    write_array(&mut out, &table.sets, |out, set| {
        write_array(out, set.iter(), write_feature_index);
    });
    out.extend_from_slice(b",\"ranges\":");
    write_array(&mut out, &table.ranges, write_range);
    out.extend_from_slice(b",\"icuPackages\":");
    write_array(&mut out, &table.icu_packages, write_icu_package);
    out.extend_from_slice(b",\"icuLanguages\":");
    write_array(&mut out, &table.icu_languages, write_icu_language);
    out.extend_from_slice(b",\"moduleTexts\":");
    write_array(&mut out, &table.module_texts, write_module_text);
    out.push(b'}');
    out
}
