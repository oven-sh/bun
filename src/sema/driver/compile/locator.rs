use crate::{Counted, Diagnostic, line_and_character, located_after};
use bun_sema::check::compute_ecma_line_starts;
use bun_sema::program::{FileId, Files};

pub struct Locator<'t, 's> {
    files: &'t Files<'s>,
    file: FileId,
    text: &'t [u8],
    starts: Vec<u32>,
    counted: Counted,
}

impl<'t, 's> Locator<'t, 's> {
    pub fn new(files: &'t Files<'s>, file: FileId) -> Locator<'t, 's> {
        let text = &files.module(file).hir.text[..];
        Locator {
            files,
            file,
            text,
            starts: compute_ecma_line_starts(text),
            counted: Counted::default(),
        }
    }

    pub fn file(&self) -> FileId {
        self.file
    }

    pub fn locate(&self, start: u32, end: u32, reported: Diagnostic) -> Diagnostic {
        let path = self.files.module(self.file).file_name();
        let (text, starts) = (self.text, &self.starts);
        Diagnostic {
            file: Some(self.file),
            ..located_after(&self.counted, path, text, starts, start, end, reported)
        }
    }
}

pub struct TextLocator<'t> {
    path: &'t [u8],
    text: &'t [u8],
    starts: Vec<u32>,
    counted: Counted,
}

impl<'t> TextLocator<'t> {
    pub fn new(path: &'t [u8], text: &'t [u8]) -> TextLocator<'t> {
        TextLocator {
            path,
            text,
            starts: compute_ecma_line_starts(text),
            counted: Counted::default(),
        }
    }

    pub fn locate(&self, start: u32, end: u32, reported: Diagnostic) -> Diagnostic {
        let (path, text, starts) = (self.path, self.text, &self.starts);
        Diagnostic {
            file: None,
            ..located_after(&self.counted, path, text, starts, start, end, reported)
        }
    }

    pub fn line_and_column(&self, offset: u32) -> (u32, u32) {
        let (line, character) = line_and_character(self.text, &self.starts, offset, &self.counted);
        (line + 1, character + 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_locator_sets_position_and_no_file() {
        let locator = TextLocator::new(b"/project/a.ts", b"let a;\nlet b;\n");
        let located = locator.locate(11, 12, crate::global(0, &[""; 0]));
        assert_eq!(located.path, b"/project/a.ts");
        assert_eq!((located.line, located.column), (2, 5));
        assert_eq!((located.end_line, located.end_column), (2, 6));
        assert_eq!(located.file, None);
    }
}
