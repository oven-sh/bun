//! For the controls of a page.

use bun_jsc::bindgen::JsList;

use super::*;
use crate::api::transfer::FileList;
use crate::generated_bindgen::forms::HTMLInputElement;

/// None at all is a cancellation.
pub(crate) fn paths_picked<'a>(
    cx: &mut Cx<'a>,
    control: &'a Element,
    paths: &[bun_web::host::ChosenFile],
) {
    let heap = control.doc().heap(&cx.heap);
    let files = (!paths.is_empty()).then(|| {
        FileList::new(
            heap,
            paths
                .iter()
                .filter_map(|it| bun_web::convert::file_at(global_of(heap), it.0.as_bytes())),
        )
    });
    Input::of(control)
        .into_iter()
        .for_each(|it| it.files_picked(cx, files));
}

pub(crate) fn files_picked<'a>(
    cx: &mut Cx<'a>,
    control: &'a HTMLInputElement,
    chosen: JsList<'a, JsLocal<'a>>,
) {
    let heap = control.doc().heap(&cx.heap);
    let files = (!chosen.is_empty()).then(|| {
        FileList::new(
            heap,
            chosen
                .iter()
                .filter_map(|it| bun_web::convert::file_chosen(global_of(heap), it.to_js())),
        )
    });
    Input::new(control).files_picked(cx, files);
}
