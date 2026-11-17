//! What `execCommand()`, menus and shortcuts can ask for.

use crate::api::core::{DomString, Known, atom};

/// Of inline content.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Format {
    Bold,
    Italic,
    Strikethrough,
    Underline,
    Subscript,
    Superscript,
    Background,
    Color,
    FontName,
    FontSize,
    Link,
}

impl Format {
    pub(super) fn is_toggle(self) -> bool {
        (self as u8) < Format::Background as u8
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Command {
    Copy,
    Cut,
    Paste,
    PasteAndMatchStyle,
    SelectAll,
    Unselect,
    Undo,
    Redo,
    StyleWithCss,
    UseCss,
    DefaultParagraphSeparator,
    Delete,
    ForwardDelete,
    DeleteSelection,
    InsertText,
    InsertHtml,
    InsertPasted,
    InsertLineBreak,
    InsertParagraph,
    Format(Format),
    Unlink,
    RemoveFormat,
    FormatBlock,
    Indent,
    Outdent,
    InsertHorizontalRule,
    InsertImage,
    /// `ol` or `ul`.
    InsertList(Known),
    /// To that value of `text-align`.
    Justify(Known),
}

impl Command {
    pub(crate) fn from_name(name: &DomString) -> Option<Command> {
        use Command as C;
        Some(match name.to_ascii_lowercase().ascii()? {
            "copy" => C::Copy,
            "cut" => C::Cut,
            "paste" => C::Paste,
            "pasteandmatchstyle" => C::PasteAndMatchStyle,
            "selectall" => C::SelectAll,
            "unselect" => C::Unselect,
            "undo" => C::Undo,
            "redo" => C::Redo,
            "stylewithcss" => C::StyleWithCss,
            "usecss" => C::UseCss,
            "defaultparagraphseparator" => C::DefaultParagraphSeparator,
            "delete" => C::Delete,
            "forwarddelete" => C::ForwardDelete,
            "inserttext" => C::InsertText,
            "inserthtml" => C::InsertHtml,
            "insertlinebreak" => C::InsertLineBreak,
            "insertparagraph" => C::InsertParagraph,
            "bold" => C::Format(Format::Bold),
            "italic" => C::Format(Format::Italic),
            "strikethrough" => C::Format(Format::Strikethrough),
            "underline" => C::Format(Format::Underline),
            "subscript" => C::Format(Format::Subscript),
            "superscript" => C::Format(Format::Superscript),
            "backcolor" | "hilitecolor" => C::Format(Format::Background),
            "forecolor" => C::Format(Format::Color),
            "fontname" => C::Format(Format::FontName),
            "fontsize" => C::Format(Format::FontSize),
            "createlink" => C::Format(Format::Link),
            "unlink" => C::Unlink,
            "removeformat" => C::RemoveFormat,
            "formatblock" => C::FormatBlock,
            "indent" => C::Indent,
            "outdent" => C::Outdent,
            "inserthorizontalrule" => C::InsertHorizontalRule,
            "insertimage" => C::InsertImage,
            "insertorderedlist" => C::InsertList(atom!("ol")),
            "insertunorderedlist" => C::InsertList(atom!("ul")),
            "justifycenter" => C::Justify(atom!("center")),
            "justifyfull" => C::Justify(atom!("justify")),
            "justifyleft" => C::Justify(atom!("left")),
            "justifyright" => C::Justify(atom!("right")),
            _ => return None,
        })
    }

    /// The `inputType`, of those that only editable elements have.
    pub(super) fn type_of_formatting(self) -> Option<Known> {
        use Command as C;
        Some(match self {
            C::Format(Format::Bold) => atom!("formatBold"),
            C::Format(Format::Italic) => atom!("formatItalic"),
            C::Format(Format::Strikethrough) => atom!("formatStrikeThrough"),
            C::Format(Format::Underline) => atom!("formatUnderline"),
            C::Format(Format::Subscript) => atom!("formatSubscript"),
            C::Format(Format::Superscript) => atom!("formatSuperscript"),
            C::Format(Format::Background) => atom!("formatBackColor"),
            C::Format(Format::Color) => atom!("formatFontColor"),
            C::Format(Format::FontName) => atom!("formatFontName"),
            C::Format(Format::Link) => atom!("insertLink"),
            C::Format(Format::FontSize) | C::Unlink | C::FormatBlock | C::InsertImage => atom!(""),
            C::RemoveFormat => atom!("formatRemove"),
            C::Indent => atom!("formatIndent"),
            C::Outdent => atom!("formatOutdent"),
            C::InsertHorizontalRule => atom!("insertHorizontalRule"),
            C::InsertList(atom!("ol")) => atom!("insertOrderedList"),
            C::InsertList(_) => atom!("insertUnorderedList"),
            C::Justify(atom!("center")) => atom!("formatJustifyCenter"),
            C::Justify(atom!("left")) => atom!("formatJustifyLeft"),
            C::Justify(atom!("right")) => atom!("formatJustifyRight"),
            C::Justify(_) => atom!("formatJustifyFull"),
            _ => return None,
        })
    }

    pub(super) fn deletes(self) -> bool {
        matches!(
            self,
            Command::Delete | Command::ForwardDelete | Command::DeleteSelection
        )
    }

    pub(super) fn suits_plain_text(self) -> bool {
        use Command as C;
        self.deletes()
            || matches!(
                self,
                C::InsertText
                    | C::InsertHtml
                    | C::InsertPasted
                    | C::InsertLineBreak
                    | C::InsertParagraph
            )
    }

    pub(super) fn is_setting(self) -> bool {
        matches!(
            self,
            Command::StyleWithCss | Command::UseCss | Command::DefaultParagraphSeparator
        )
    }
}
