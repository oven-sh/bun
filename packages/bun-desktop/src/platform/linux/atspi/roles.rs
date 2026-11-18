//! The numbers are those of atspi-constants.h.

use crate::abi::accessibility::{self as abi, Number, Relation, Role, Text};
use crate::accessibility::forest::{Forest, Id, Node};
use crate::accessibility::search::{is_landmark, is_link};

pub const APPLICATION: (u32, &str) = (75, "application");
pub const FRAME: (u32, &str) = (23, "frame");

pub fn role(forest: &Forest, id: Id, node: &Node) -> (u32, &'static str) {
    use Role::*;
    match forest.math_tag(id, node).unwrap_or_default() {
        "annotation" | "mi" | "mn" | "mo" | "ms" | "mtext" => return (116, "static"),
        "mfrac" => return (117, "math fraction"),
        "mroot" | "msqrt" => return (118, "math root"),
        "mtable" => return (55, "table"),
        "mtd" => return (56, "table cell"),
        "mtr" => return (90, "table row"),
        _ => {}
    }
    match node.role {
        _ if node.has(abi::PROTECTED) => (40, "password text"),
        _ if is_link(node) => (88, "link"),
        Application | EmbeddedObject => (78, "embedded"),
        Form if node.name().is_empty() => (87, "form"),
        _ if is_landmark(node) => (110, "landmark"),
        DocAcknowledgments | DocAfterword | DocAppendix | DocBibliography | DocChapter
        | DocConclusion | DocCredits | DocEndnotes | DocEpilogue | DocErrata | DocForeword
        | DocGlossary | DocIndex | DocIntroduction | DocPageList | DocPart | DocPreface
        | DocPrologue | DocToc => (110, "landmark"),
        Alert => (101, "notification"),
        AlertDialog => (2, "alert"),
        Article => (109, "article"),
        Audio => (106, "audio"),
        Blockquote => (105, "block quote"),
        Button if node.has(abi::CHECKABLE) => (62, "toggle button"),
        Button | ColorWell => (43, "push button"),
        Canvas => (6, "canvas"),
        Caption | Figcaption => (81, "caption"),
        Cell | GridCell => (56, "table cell"),
        Checkbox => (7, "check box"),
        ColumnHeader => (10, "column header"),
        Combobox => (11, "combo box"),
        Comment | Note | DocNotice | DocTip => (97, "comment"),
        Date | DateTime | InputTime => (12, "date editor"),
        Definition => (123, "description value"),
        Deletion => (125, "content deletion"),
        DescriptionList => (121, "description list"),
        Dialog => (16, "dialog"),
        DisclosureTriangle | Switch => (62, "toggle button"),
        DocFootnote => (124, "footnote"),
        Document | GraphicsDocument => (82, "document frame"),
        Feed | Figure | GraphicsObject | Group | RadioGroup | RowGroup => (39, "panel"),
        Grid | Table => (55, "table"),
        Heading | DocSubtitle => (83, "heading"),
        Iframe => (28, "internal frame"),
        Image | DocCover | GraphicsSymbol => (27, "image"),
        Insertion => (126, "content insertion"),
        Label | Legend => (29, "label"),
        List => (31, "list"),
        Listbox => (98, "list box"),
        Option if forest.closest(id, |it| it.has(abi::MENU_LIST)).is_some() => (35, "menu item"),
        ListItem | Option | DocBiblioEntry | DocEndnote => (32, "list item"),
        Log => (111, "log"),
        Mark => (127, "mark"),
        Marquee => (112, "marquee"),
        Math => (113, "math"),
        Menu | MenuListPopup => (33, "menu"),
        Menubar => (34, "menu bar"),
        MenuItem => (35, "menu item"),
        MenuItemCheckbox => (8, "check menu item"),
        MenuItemRadio => (45, "radio menu item"),
        Meter => (103, "level bar"),
        Paragraph => (73, "paragraph"),
        ProgressBar => (42, "progress bar"),
        Radio => (44, "radio button"),
        Row => (90, "table row"),
        RowHeader => (47, "row header"),
        Scrollbar => (48, "scroll bar"),
        Textbox if node.has(abi::IMPLICIT_ROLE) && !node.has(abi::ATOMIC_FIELD) => (85, "section"),
        Searchbox | Textbox => (79, "entry"),
        SectionFooter | DocPageFooter => (72, "footer"),
        SectionHeader | DocPageHeader => (71, "header"),
        Separator | DocPageBreak => (50, "separator"),
        Slider => (51, "slider"),
        SpinButton => (52, "spin button"),
        Abbreviation | Code | Emphasis | LineBreak | ListMarker | Ruby | StaticText | Strong
        | Time => (116, "static"),
        Status => (54, "status bar"),
        Subscript => (119, "subscript"),
        Suggestion => (128, "suggestion"),
        Superscript => (120, "superscript"),
        Tab => (37, "page tab"),
        TabList => (38, "page tab list"),
        TabPanel => (49, "scroll pane"),
        Term => (122, "description term"),
        Timer => (115, "timer"),
        Toolbar => (63, "tool bar"),
        Tooltip => (64, "tool tip"),
        Tree => (65, "tree"),
        TreeGrid => (66, "tree table"),
        TreeItem => (91, "tree item"),
        Video => (107, "video"),
        WebArea => (95, "document web"),
        _ => (85, "section"),
    }
}

pub const ACTIVE: u8 = 1;
pub const DEFUNCT: u8 = 6;
pub const ENABLED: u8 = 8;
pub const RESIZABLE: u8 = 21;
pub const SENSITIVE: u8 = 24;
pub const SHOWING: u8 = 25;
pub const VISIBLE: u8 = 30;

/// Those that only depend on `states`.
pub fn simple_states(role: Role, states: u64) -> impl Iterator<Item = (u8, &'static str, bool)> {
    let has = |it| states & it != 0;
    let is_editable = has(abi::EDITABLE) && !has(abi::READ_ONLY | abi::DISABLED);
    [
        (3, "busy", has(abi::BUSY | abi::LOADING)),
        (4, "checked", has(abi::CHECKED) && role != Role::Button),
        (7, "editable", is_editable),
        (ENABLED, "enabled", !has(abi::DISABLED)),
        (9, "expandable", has(abi::EXPANDED | abi::COLLAPSED)),
        (10, "expanded", has(abi::EXPANDED)),
        (11, "focusable", has(abi::FOCUSABLE)),
        (14, "horizontal", has(abi::HORIZONTAL)),
        (16, "modal", has(abi::MODAL)),
        (
            17,
            "multi-line",
            has(abi::TEXT_FIELD) && has(abi::MULTILINE),
        ),
        (18, "multiselectable", has(abi::MULTISELECTABLE)),
        (20, "pressed", has(abi::CHECKED) && role == Role::Button),
        (22, "selectable", has(abi::SELECTABLE)),
        (23, "selected", has(abi::SELECTED)),
        (SENSITIVE, "sensitive", !has(abi::DISABLED)),
        (
            26,
            "single-line",
            has(abi::TEXT_FIELD) && !has(abi::MULTILINE),
        ),
        (29, "vertical", has(abi::VERTICAL)),
        (32, "indeterminate", has(abi::MIXED)),
        (33, "required", has(abi::REQUIRED)),
        (38, "selectable-text", has(abi::TEXT_FIELD)),
        (41, "checkable", has(abi::CHECKABLE) && role != Role::Button),
        (43, "read-only", has(abi::READ_ONLY)),
    ]
    .into_iter()
}

pub fn states(forest: &Forest, id: Id, node: &Node) -> u64 {
    let more = [
        (11, forest.is_focused(id)),
        (12, forest.is_focused(id)),
        (SHOWING, !forest.is_offscreen(id)),
        (VISIBLE, true),
        (
            32,
            node.role == Role::ProgressBar && node.number(Number::Now).is_none(),
        ),
        (36, node.text(Text::Invalid).is_some()),
        (37, node.text(Text::Autocomplete).is_some()),
        (42, node.text(Text::HasPopup).is_some()),
        (ACTIVE, node.text(Text::Current).is_some()),
    ];
    simple_states(node.role, node.states)
        .map(|it| (it.0, it.2))
        .chain(more)
        .fold(0, |all, it| all | u64::from(it.1) << it.0)
}

/// With the reverse.
pub const RELATIONS: [(Relation, u32, u32); 6] = [
    (Relation::LabelledBy, 2, 1),
    (Relation::Controls, 3, 4),
    (Relation::FlowTo, 10, 11),
    (Relation::DescribedBy, 18, 17),
    (Relation::Details, 19, 20),
    (Relation::ErrorMessage, 21, 22),
];
pub const MEMBER_OF: u32 = 5;
pub const NODE_CHILD_OF: u32 = 7;
pub const EMBEDS: u32 = 13;

pub fn attributes(forest: &Forest, id: Id, node: &Node) -> Vec<(&'static str, String)> {
    let texts = [
        (Text::Autocomplete, "autocomplete"),
        (Text::BrailleLabel, "braillelabel"),
        (Text::BrailleRoleDescription, "brailleroledescription"),
        (Text::ColumnIndex, "colindex"),
        (Text::Current, "current"),
        (Text::DomClass, "class"),
        (Text::DomId, "id"),
        (Text::HasPopup, "haspopup"),
        (Text::InputType, "text-input-type"),
        (Text::KeyShortcuts, "keyshortcuts"),
        (Text::LiveRelevant, "relevant"),
        (Text::Placeholder, "placeholder"),
        (Text::RoleDescription, "roledescription"),
        (Text::RowIndex, "rowindex"),
        (Text::Sort, "sort"),
        (Text::Tag, "tag"),
        (Text::Value, "valuetext"),
    ];
    let mut all: Vec<_> = texts
        .into_iter()
        .filter_map(|it| Some((it.1, node.text(it.0)?.to_owned())))
        .collect();
    all.extend(
        node.number(Number::Now)
            .filter(|_| node.text(Text::Value).is_none() && !node.has(abi::TEXT_FIELD))
            .map(|it| ("valuetext", it.to_string())),
    );
    let numbers = [
        (Number::Level, "level"),
        (Number::RowCount, "rowcount"),
        (Number::ColumnCount, "colcount"),
    ];
    all.extend(
        numbers
            .into_iter()
            .filter_map(|it| Some((it.1, node.number(it.0)?.to_string()))),
    );
    if let Some([position, size]) = forest.place_in_set(id).filter(|_| node.may_be_in_set()) {
        all.extend([
            ("posinset", position.to_string()),
            ("setsize", size.to_string()),
        ]);
    }
    if !node.has(abi::IMPLICIT_ROLE) && !node.is_text()
        || is_landmark(node)
        || matches!(
            node.role,
            Role::Article | Role::Figure | Role::Mark | Role::Time
        )
    {
        all.push(("xml-roles", node.role.name().to_owned()));
    }
    if !node.is_text() {
        all.push((
            "display",
            if node.has(abi::BLOCK) {
                "block"
            } else {
                "inline"
            }
            .to_owned(),
        ));
    }
    if !node.name().is_empty() && !node.is_text() && !node.has(abi::NAMED_BY_CONTENT) {
        all.push(("explicit-name", "true".to_owned()));
    }
    let is_region = |it: &Node| it.is_live() || it.has(abi::LIVE_OFF);
    if let Some(region) = forest.closest(id, is_region).and_then(|it| forest.get(it)) {
        let live = if region.has(abi::LIVE_ASSERTIVE) {
            "assertive"
        } else if region.has(abi::LIVE_POLITE) {
            "polite"
        } else {
            "off"
        };
        let is_atomic = region.has(abi::LIVE_ATOMIC).to_string();
        if is_region(node) {
            all.extend([("live", live.to_owned()), ("atomic", is_atomic.clone())]);
        }
        all.extend([
            ("container-live", live.to_owned()),
            ("container-atomic", is_atomic),
            (
                "container-relevant",
                region
                    .text(Text::LiveRelevant)
                    .unwrap_or_default()
                    .to_owned(),
            ),
            (
                "container-busy",
                forest
                    .closest(id, |it| it.has(abi::BUSY))
                    .is_some()
                    .to_string(),
            ),
        ]);
    }
    all
}
