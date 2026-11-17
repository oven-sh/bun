//! The tree that assistive technologies see, as `bun_dom` passes it to the UI library.
#![allow(dead_code, unreachable_pub)] // Each side uses its half.

use super::{Rect, Slice, Span};

macro_rules! roles {
    ($($role:ident $name:literal,)*) => {
        #[repr(u8)]
        #[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
        pub enum Role {
            #[default]
            $($role,)*
        }

        impl Role {
            pub const ALL: &[Role] = &[$(Role::$role,)*];

            /// In lower case if ARIA has the role, and otherwise as the DevTools protocol calls it.
            pub fn name(self) -> &'static str {
                match self {
                    $(Role::$role => $name,)*
                }
            }

            pub fn named(name: &str) -> Option<Role> {
                Some(match name {
                    $($name => Role::$role,)*
                    _ => return None,
                })
            }
        }
    };
}

roles! {
    Generic "generic", Alert "alert", AlertDialog "alertdialog", Application "application", Article "article",
    Banner "banner", Blockquote "blockquote", Button "button", Caption "caption", Cell "cell", Checkbox "checkbox",
    Code "code", ColumnHeader "columnheader", Combobox "combobox", Comment "comment", Complementary "complementary",
    ContentInfo "contentinfo", Definition "definition", Deletion "deletion", Dialog "dialog", Document "document",
    Emphasis "emphasis", Feed "feed", Figure "figure", Form "form", GraphicsDocument "graphics-document",
    GraphicsObject "graphics-object", GraphicsSymbol "graphics-symbol", Grid "grid", GridCell "gridcell", Group "group",
    Heading "heading", Image "image", Insertion "insertion", Link "link", List "list", Listbox "listbox",
    ListItem "listitem", Log "log", Main "main", Mark "mark", Marquee "marquee", Math "math", Menu "menu",
    Menubar "menubar", MenuItem "menuitem", MenuItemCheckbox "menuitemcheckbox", MenuItemRadio "menuitemradio",
    Meter "meter", Navigation "navigation", None "none", Note "note", Option "option", Paragraph "paragraph",
    ProgressBar "progressbar", Radio "radio", RadioGroup "radiogroup", Region "region", Row "row", RowGroup "rowgroup",
    RowHeader "rowheader", Scrollbar "scrollbar", Search "search", Searchbox "searchbox", SectionFooter "sectionfooter",
    SectionHeader "sectionheader", Separator "separator", Slider "slider", SpinButton "spinbutton", Status "status",
    Strong "strong", Subscript "subscript", Suggestion "suggestion", Superscript "superscript", Switch "switch",
    Tab "tab", Table "table", TabList "tablist", TabPanel "tabpanel", Term "term", Textbox "textbox", Time "time",
    Timer "timer", Toolbar "toolbar", Tooltip "tooltip", Tree "tree", TreeGrid "treegrid", TreeItem "treeitem",
    DocAbstract "doc-abstract", DocAcknowledgments "doc-acknowledgments", DocAfterword "doc-afterword",
    DocAppendix "doc-appendix", DocBacklink "doc-backlink", DocBiblioEntry "doc-biblioentry",
    DocBibliography "doc-bibliography", DocBiblioRef "doc-biblioref", DocChapter "doc-chapter",
    DocColophon "doc-colophon", DocConclusion "doc-conclusion", DocCover "doc-cover", DocCredit "doc-credit",
    DocCredits "doc-credits", DocDedication "doc-dedication", DocEndnote "doc-endnote", DocEndnotes "doc-endnotes",
    DocEpigraph "doc-epigraph", DocEpilogue "doc-epilogue", DocErrata "doc-errata", DocExample "doc-example",
    DocFootnote "doc-footnote", DocForeword "doc-foreword", DocGlossary "doc-glossary", DocGlossRef "doc-glossref",
    DocIndex "doc-index", DocIntroduction "doc-introduction", DocNoteRef "doc-noteref", DocNotice "doc-notice",
    DocPageBreak "doc-pagebreak", DocPageFooter "doc-pagefooter", DocPageHeader "doc-pageheader",
    DocPageList "doc-pagelist", DocPart "doc-part", DocPreface "doc-preface", DocPrologue "doc-prologue",
    DocPullquote "doc-pullquote", DocQna "doc-qna", DocSubtitle "doc-subtitle", DocTip "doc-tip", DocToc "doc-toc",
    WebArea "RootWebArea", StaticText "StaticText", LineBreak "LineBreak", ListMarker "ListMarker", Label "LabelText",
    Legend "Legend", Figcaption "Figcaption", Iframe "Iframe", Canvas "Canvas", Video "Video", Audio "Audio",
    DisclosureTriangle "DisclosureTriangle", DescriptionList "DescriptionList", Abbreviation "Abbr", Ruby "Ruby",
    ColorWell "ColorWell", Date "Date", DateTime "DateTime", InputTime "InputTime", MenuListPopup "MenuListPopup",
    EmbeddedObject "EmbeddedObject",
}

pub const FOCUSABLE: u64 = 1;
pub const DISABLED: u64 = 1 << 1;
pub const READ_ONLY: u64 = 1 << 2;
pub const REQUIRED: u64 = 1 << 3;
/// In a text field or an editing host, or one of them.
pub const EDITABLE: u64 = 1 << 4;
/// Its text can be edited, or could if it were not read-only or disabled.
pub const TEXT_FIELD: u64 = 1 << 5;
/// `input` and `textarea`, whose descendants only serve to find positions in the text.
pub const ATOMIC_FIELD: u64 = 1 << 6;
pub const MULTILINE: u64 = 1 << 7;
pub const PROTECTED: u64 = 1 << 8;
pub const MULTISELECTABLE: u64 = 1 << 9;
pub const SELECTABLE: u64 = 1 << 10;
pub const SELECTED: u64 = 1 << 11;
pub const EXPANDED: u64 = 1 << 12;
pub const COLLAPSED: u64 = 1 << 13;
/// Also whether a button can be pressed, and stays so.
pub const CHECKABLE: u64 = 1 << 14;
pub const CHECKED: u64 = 1 << 15;
pub const MIXED: u64 = 1 << 16;
pub const HORIZONTAL: u64 = 1 << 17;
pub const VERTICAL: u64 = 1 << 18;
pub const MODAL: u64 = 1 << 19;
pub const BUSY: u64 = 1 << 20;
pub const CLICKABLE: u64 = 1 << 21;
pub const LIVE_POLITE: u64 = 1 << 22;
pub const LIVE_ASSERTIVE: u64 = 1 << 23;
pub const LIVE_OFF: u64 = 1 << 24;
pub const LIVE_ATOMIC: u64 = 1 << 25;
/// `name` is the text of its descendants.
pub const NAMED_BY_CONTENT: u64 = 1 << 26;
/// `name` is the text of other nodes.
pub const NAMED_BY_RELATION: u64 = 1 << 27;
/// The text before it is in another block.
pub const STARTS_PARAGRAPH: u64 = 1 << 28;
pub const SCROLLS: u64 = 1 << 29;
/// The descendants are only there for their text.
pub const PRESENTATIONAL_CHILDREN: u64 = 1 << 30;
/// A drop-down `select`.
pub const MENU_LIST: u64 = 1 << 31;
pub const BOLD: u64 = 1 << 32;
pub const ITALIC: u64 = 1 << 33;
pub const UNDERLINED: u64 = 1 << 34;
pub const STRUCK: u64 = 1 << 35;
pub const LOADING: u64 = 1 << 36;
pub const RICHLY_EDITABLE: u64 = 1 << 37;
/// It clips what does not fit.
pub const CLIPS: u64 = 1 << 38;
/// An empty `alt` or `aria-label`.
pub const EXPLICITLY_UNNAMED: u64 = 1 << 39;
pub const DESCRIBED_BY_ARIA: u64 = 1 << 40;
/// It is not on a line.
pub const BLOCK: u64 = 1 << 41;
/// The author has not chosen it.
pub const IMPLICIT_ROLE: u64 = 1 << 42;
/// `pointer-events: none`
pub const PASSES_POINTER: u64 = 1 << 43;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Text {
    Name,
    /// Of what is not a text field.
    Value,
    Description,
    Placeholder,
    Url,
    RoleDescription,
    Current,
    Invalid,
    HasPopup,
    Sort,
    Autocomplete,
    KeyShortcuts,
    AccessKey,
    Language,
    LiveRelevant,
    BrailleLabel,
    BrailleRoleDescription,
    DomId,
    DomClass,
    Tag,
    FontFamily,
    RowIndex,
    ColumnIndex,
    InputType,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Number {
    Now,
    Min,
    Max,
    Step,
    Level,
    PositionInSet,
    SetSize,
    RowCount,
    ColumnCount,
    RowSpan,
    ColumnSpan,
    FontSize,
    /// `0xRRGGBBAA`
    Color,
    /// The image that shows another document.
    Frame,
    /// One for each of the layers that it is painted in, from the outside in, unless they are those of the parent. The first is 0.
    /// The level times `LAYER_LEVEL`, plus what tells it from others.
    Layer,
}

pub const LAYER_LEVEL: f64 = (1u64 << 32) as f64;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Relation {
    ActiveDescendant,
    Controls,
    DescribedBy,
    Details,
    ErrorMessage,
    FlowTo,
    LabelledBy,
    Owns,
    /// Of a link to a part of the page.
    Target,
    RadioGroup,
    Headers,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct TextEntry {
    pub key: Text,
    /// In `bytes`.
    pub value: Span,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NumberEntry {
    pub key: Number,
    pub value: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RelationEntry {
    pub key: Relation,
    pub node: u32,
}

/// A piece of the name of a `StaticText` that is on one line and has one direction.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Run {
    /// A UTF-8 offset. It ends where the next one starts.
    pub start: u32,
    /// Relative to the corner of the node.
    pub rect: Rect,
    pub is_rtl: bool,
    pub is_vertical: bool,
    /// The text before it is in the same block, on another line.
    pub starts_line: bool,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Node {
    /// Never that of a node that was removed.
    pub id: u32,
    pub role: Role,
    pub states: u64,
    pub children: Span,
    pub texts: Span,
    pub numbers: Span,
    pub relations: Span,
    pub runs: Span,
    /// One for each character of the name of a `StaticText`.
    pub advances: Span,
    /// UTF-8 ranges of that name which are misspelled.
    pub misspelled: Span,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Placement {
    pub id: u32,
    /// The node that scrolls it, or 0.
    pub container: u32,
    /// From the corner of the container, as if that were not scrolled.
    pub rect: Rect,
    pub scroll: [f32; 2],
}

/// A UTF-8 offset in the name of a `StaticText`, and otherwise the index of a child.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Point {
    pub node: u32,
    pub offset: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Selection {
    /// A `node` of 0 is no selection.
    pub anchor: Point,
    pub focus: Point,
    pub is_upstream: bool,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Announcement {
    /// In `bytes`.
    pub text: Span,
    pub is_urgent: bool,
}

/// What has changed since the last one. Lengths are CSS pixels.
#[repr(C)]
pub struct Update {
    /// Forget what came before.
    pub is_first: bool,
    /// What is not in `nodes` was removed.
    pub is_complete: bool,
    pub zoom: f32,
    pub root: u32,
    pub focus: u32,
    pub selection: Selection,
    pub removed: Slice<u32>,
    pub nodes: Slice<Node>,
    pub placements: Slice<Placement>,
    pub announcements: Slice<Announcement>,
    pub children: Slice<u32>,
    pub texts: Slice<TextEntry>,
    pub numbers: Slice<NumberEntry>,
    pub relations: Slice<RelationEntry>,
    pub runs: Slice<Run>,
    pub advances: Slice<f32>,
    pub misspelled: Slice<[u32; 2]>,
    pub bytes: Slice<u8>,
}

/// With the number of an image instead of that of a surface: the tree of what a web view shows.
pub const TREE_OF_IMAGE: u32 = 1 << 31;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Click,
    Focus,
    Blur,
    SetValue,
    Increment,
    Decrement,
    Expand,
    Collapse,
    ScrollIntoView,
    ShowContextMenu,
    /// From one `Point` to another.
    SelectText,
    ReplaceSelectedText,
    Select,
    Deselect,
    Cancel,
}

impl Action {
    pub const ALL: [Action; 15] = {
        use Action::*;
        [
            Click,
            Focus,
            Blur,
            SetValue,
            Increment,
            Decrement,
            Expand,
            Collapse,
            ScrollIntoView,
            ShowContextMenu,
            SelectText,
            ReplaceSelectedText,
            Select,
            Deselect,
            Cancel,
        ]
    };
}
