use super::Value;
use crate::abi::accessibility::{self as abi, Number, Role, Text};
use crate::accessibility::forest::{Forest, Id, Node};
use crate::accessibility::search::is_link;

fn is_toggle(node: &Node) -> bool {
    node.role == Role::Button && node.has(abi::CHECKABLE)
}

fn is_details(node: &Node) -> bool {
    node.role == Role::Group
        && node.has(abi::IMPLICIT_ROLE)
        && node.text(Text::Tag) == Some("details")
}

fn says_nothing(node: &Node) -> bool {
    node.name().is_empty()
        && !node.has(abi::FOCUSABLE | abi::CLICKABLE | abi::TEXT_FIELD)
        && node
            .text(Text::Value)
            .or(node.text(Text::Description))
            .is_none()
        && node.number(Number::Frame).is_none()
        && !super::has_range(node)
}

/// VoiceOver passes over it.
fn is_empty_group(forest: &Forest, id: Id, node: &Node) -> bool {
    !matches!(
        node.role,
        Role::Alert
            | Role::Audio
            | Role::Log
            | Role::Marquee
            | Role::Math
            | Role::Status
            | Role::Timer
            | Role::Video
    ) && !node.has(abi::FOCUSABLE | abi::TEXT_FIELD)
        && node.number(Number::Frame).is_none()
        && role(forest, id, node) == "AXGroup"
        && forest
            .descendants(id)
            .all(|it| it == id || forest.get(it).is_some_and(says_nothing))
}

pub fn role(forest: &Forest, id: Id, node: &Node) -> &'static str {
    use Role::*;
    let has_children = || !forest.is_leaf(id) && forest.children(id).next().is_some();
    match node.role {
        _ if node.has(abi::TEXT_FIELD) && node.has(abi::MULTILINE) => "AXTextArea",
        _ if node.has(abi::MENU_LIST) => "AXPopUpButton",
        _ if is_toggle(node) => "AXCheckBox",
        _ if is_link(node) => "AXLink",
        Button if node.text(Text::HasPopup).is_some() => "AXPopUpButton",
        Button | DisclosureTriangle => "AXButton",
        Canvas | Image | DocCover | GraphicsSymbol if has_children() => "AXGroup",
        Canvas | Image | DocCover | GraphicsSymbol => "AXImage",
        Cell | ColumnHeader | GridCell | RowHeader => "AXCell",
        Checkbox | Switch => "AXCheckBox",
        ColorWell => "AXColorWell",
        Combobox => "AXComboBox",
        Date | DateTime => "AXDateField",
        DescriptionList | List | Listbox => "AXList",
        Grid | Table | TreeGrid => "AXTable",
        Heading | DocSubtitle => "AXHeading",
        InputTime => "AXTimeField",
        ListMarker => "AXListMarker",
        Menu if !forest
            .descendants(id)
            .any(|it| forest.get(it).is_some_and(super::is_menu_item)) =>
        {
            "AXGroup"
        }
        Menu | MenuListPopup => "AXMenu",
        Menubar => "AXMenuBar",
        Option
            if forest
                .closest(id, |it| matches!(it.role, Combobox | MenuListPopup))
                .is_none() =>
        {
            "AXStaticText"
        }
        MenuItem | MenuItemCheckbox | MenuItemRadio | Option => "AXMenuItem",
        Meter => "AXLevelIndicator",
        ProgressBar => "AXProgressIndicator",
        Radio | Tab => "AXRadioButton",
        RadioGroup => "AXRadioGroup",
        Row | TreeItem => "AXRow",
        Scrollbar => "AXScrollBar",
        Searchbox | Textbox => "AXTextField",
        Separator | DocPageBreak => "AXSplitter",
        Slider => "AXSlider",
        SpinButton => "AXIncrementor",
        StaticText => "AXStaticText",
        TabList => "AXTabGroup",
        Toolbar => "AXToolbar",
        Tree => "AXOutline",
        WebArea => "AXWebArea",
        _ if node.has(abi::TEXT_FIELD) => "AXTextField",
        _ => "AXGroup",
    }
}

/// With what it is called.
fn group(role: Role) -> Option<(&'static str, &'static str)> {
    use Role::*;
    Some(match role {
        Alert => ("AXApplicationAlert", "alert"),
        AlertDialog => ("AXApplicationAlertDialog", "alert dialog|web alert dialog"),
        Application => ("AXWebApplication", "application|web application"),
        Article => ("AXDocumentArticle", "article"),
        Banner => ("AXLandmarkBanner", "banner"),
        Complementary => ("AXLandmarkComplementary", "complementary"),
        ContentInfo => ("AXLandmarkContentInfo", "content information"),
        Definition => ("AXDefinition", "definition"),
        DescriptionList => ("AXDefinitionList", "definition list|description list"),
        Dialog => ("AXApplicationDialog", "dialog|web dialog"),
        Document | GraphicsDocument => ("AXDocument", "document"),
        Feed => ("AXApplicationGroup", "feed"),
        Form => ("AXLandmarkForm", "form"),
        Log => ("AXApplicationLog", "log"),
        Main => ("AXLandmarkMain", "main"),
        Marquee => ("AXApplicationMarquee", "marquee"),
        Math => ("AXDocumentMath", "math"),
        Navigation => ("AXLandmarkNavigation", "navigation"),
        Note => ("AXDocumentNote", "note"),
        Region => ("AXLandmarkRegion", "region"),
        Search => ("AXLandmarkSearch", "search"),
        SectionFooter => ("AXSectionFooter", "section footer"),
        SectionHeader => ("AXSectionHeader", "section header"),
        Status => ("AXApplicationStatus", "status|application status"),
        TabPanel => ("AXTabPanel", "tab panel"),
        Term => ("AXTerm", "term"),
        Timer => ("AXApplicationTimer", "timer"),
        Tooltip => ("AXUserInterfaceTooltip", "tooltip"),
        Video => ("AXVideo", "video playback"),
        _ => return core::option::Option::None,
    })
}

fn subrole_in_math(tag: &str) -> Option<&'static str> {
    Some(match tag {
        "annotation" | "mtext" => "AXMathText",
        "mfrac" => "AXMathFraction",
        "mi" => "AXMathIdentifier",
        "mmultiscripts" => "AXMathMultiscript",
        "mn" => "AXMathNumber",
        "mo" => "AXMathOperator",
        "mover" | "munder" | "munderover" => "AXMathUnderOver",
        "mroot" => "AXMathRoot",
        "ms" => return None,
        "msqrt" => "AXMathSquareRoot",
        "msub" | "msubsup" | "msup" => "AXMathSubscriptSuperscript",
        "mtable" => "AXMathTable",
        "mtd" => "AXMathTableCell",
        "mtr" => "AXMathTableRow",
        _ => "AXMathRow",
    })
}

pub fn subrole(forest: &Forest, id: Id, node: &Node) -> Option<&'static str> {
    use Role::*;
    if let Some(tag) = forest.math_tag(id, node) {
        return subrole_in_math(tag);
    }
    Some(match node.role {
        _ if node.has(abi::PROTECTED) => "AXSecureTextField",
        _ if is_toggle(node) => "AXToggleButton",
        Group if node.text(Text::Tag) == Some("fieldset") => "AXFieldset",
        _ if is_empty_group(forest, id, node) => "AXEmptyGroup",
        Code => "AXCodeStyleGroup",
        Deletion => "AXDeleteStyleGroup",
        Emphasis => "AXEmphasisStyleGroup",
        Group if is_details(node) => return core::option::Option::None,
        Group => "AXApplicationGroup",
        Insertion => "AXInsertStyleGroup",
        List => "AXContentList",
        Meter => "AXMeter",
        Ruby => "AXRubyInline",
        Searchbox => "AXSearchField",
        Strong => "AXStrongStyleGroup",
        Subscript => "AXSubscriptStyleGroup",
        Superscript => "AXSuperscriptStyleGroup",
        Switch => "AXSwitch",
        Tab => "AXTabButton",
        Time => "AXTimeGroup",
        TreeItem => "AXOutlineRow",
        role => return group(role).map(|it| it.0),
    })
}

pub fn description(forest: &Forest, id: Id, node: &Node) -> Value {
    if let Some(given) = node.text(Text::RoleDescription) {
        return Value::Text(given.to_owned());
    }
    let of_input = [
        (
            "datetime-local",
            "local date and time picker|date and time field",
        ),
        ("email", "email|email field"),
        ("month", "month picker|month and year field"),
        ("tel", "telephone|telephone number field"),
        ("url", "url|URL field"),
        ("week", "week picker|week and year field"),
    ];
    let of_input = node
        .text(Text::InputType)
        .and_then(|kind| of_input.iter().find(|it| kind.eq_ignore_ascii_case(it.0)));
    let phrase = match node.role {
        Role::DocBacklink => "back link|link",
        Role::DocBiblioEntry => "bibliography entry",
        Role::DocBiblioRef => "bibliography reference|link",
        Role::DocGlossRef => "glossary reference|link",
        Role::DocNoteRef => "note reference|link",
        Role::DocPageBreak => "page break",
        Role::DocPageFooter => "page footer",
        Role::DocPageHeader => "page header",
        Role::DocPageList => "page list",
        Role::DocQna => "Q&A",
        Role::DocToc => "table of contents",
        own if let Some(name) = own.name().strip_prefix("doc-") => name,
        Role::GraphicsDocument => "graphics document|document",
        Role::GraphicsObject => "graphics object",
        Role::GraphicsSymbol => "graphics symbol",
        Role::Menu => "menu",
        _ if is_link(node) => "link",
        _ if is_toggle(node) => {
            return Value::RoleDescription(None, "AXCheckBox", Some("AXToggle"));
        }
        _ if is_details(node) => "details",
        Role::Audio => "audio|audio playback",
        Role::Blockquote => "blockquote",
        Role::Code => "code",
        Role::ColorWell => "color well",
        Role::ColumnHeader => "column header",
        Role::Comment => "comment",
        Role::Date => "date picker|date field",
        Role::Deletion => "deletion",
        Role::DisclosureTriangle => "disclosure triangle",
        Role::EmbeddedObject => "object",
        Role::Emphasis => "emphasis",
        Role::Figure => "figure",
        Role::Heading => "heading",
        Role::InputTime => "time field",
        Role::Insertion => "insertion",
        Role::ListMarker => "list marker",
        Role::Listbox => "list box",
        Role::Mark => "highlight|highlighted",
        Role::RowGroup => "row group",
        Role::RowHeader => "row header",
        Role::Strong => "strong",
        Role::Subscript => "subscript",
        Role::Suggestion => "suggestion",
        Role::Superscript => "superscript",
        Role::Time => "time",
        Role::TreeGrid => "tree grid",
        Role::WebArea => "HTML content",
        own => of_input.or(group(own).as_ref()).map_or("", |it| it.1),
    };
    Value::RoleDescription(
        Some(phrase).filter(|it| !it.is_empty()),
        role(forest, id, node),
        subrole(forest, id, node),
    )
}
