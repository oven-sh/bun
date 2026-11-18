use bun_engine_standalone as _;
use bun_icu::Buffer;
use bun_icu::calendar::Calendar;
use bun_icu::date_format::{self, DateFormat, Style, field};
use bun_icu::date_interval_format::DateIntervalFormat;
use bun_icu::date_pattern::{self, Field, PatternGenerator, Width};
use bun_icu::formatted_value::Category;

const DAY: f64 = 86_400_000.0;

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn text(units: &[u16]) -> String {
    String::from_utf16(units).unwrap()
}

fn calendar_at(time: f64) -> Calendar {
    let mut calendar = Calendar::open(&units("Asia/Tokyo"), c"en").unwrap();
    calendar.set_millis(time).unwrap();
    calendar
}

#[test]
fn patterns_from_skeletons() {
    let mut generator = PatternGenerator::open(c"de").unwrap();
    let mut best = |skeleton| text(&generator.best_pattern(&units(skeleton)).unwrap());
    assert_eq!(best("yMd"), "d.M.y");
    assert_eq!(best("j"), "HH 'Uhr'");
    assert_eq!(best(""), "");
}

#[test]
fn skeletons_from_patterns() {
    let skeleton = |pattern| text(&date_pattern::skeleton(&units(pattern)).unwrap());
    assert_eq!(skeleton("EEEE, d 'de' MMMM 'de' y"), "yMMMMEEEEd");
    assert_eq!(skeleton("h 'o''clock' a"), "ah");
    assert_eq!(skeleton(""), "");
}

#[test]
fn names_of_fields() {
    let generator = PatternGenerator::open(c"en").unwrap();
    let name = |field, width| text(&generator.field_name(field, width).unwrap());
    assert_eq!(name(Field::Weekday, Width::Wide), "day of the week");
    assert_eq!(name(Field::Quarter, Width::Abbreviated), "qtr.");
    assert_eq!(name(Field::Minute, Width::Narrow), "min");
}

#[test]
fn patterns_of_styles() {
    let pattern = |date, time| text(&date_format::style_pattern(c"de", date, time).unwrap());
    assert_eq!(pattern(Some(Style::Long), None), "d. MMMM y");
    assert_eq!(pattern(None, Some(Style::Short)), "HH:mm");
    assert_eq!(
        pattern(Some(Style::Full), Some(Style::Medium)),
        "EEEE, d. MMMM y 'um' HH:mm:ss"
    );
}

#[test]
fn text_and_fields_of_a_date() {
    let format = DateFormat::open(c"en", &units("EEEE, MMMM d, y 'at' H:mm zzzz")).unwrap();
    let expected = "Thursday, January 1, 1970 at 9:00 Japan Standard Time";
    let mut out = Buffer::new();
    format.format(&mut calendar_at(0.0), &mut out).unwrap();
    assert_eq!(text(&out), expected);

    let mut out = Buffer::new();
    let fields = format.format_fields(&mut calendar_at(0.0), &mut out);
    assert_eq!(text(&out), expected);
    assert_eq!(
        fields.unwrap().collect::<Vec<_>>(),
        [
            (field::WEEKDAY, 0..8),
            (field::MONTH, 10..17),
            (field::DAY, 18..19),
            (field::YEAR, 21..25),
            (field::HOUR_0_TO_23, 29..30),
            (field::MINUTE, 31..33),
            (field::ZONE_SPECIFIC, 34..53),
        ]
    );
}

#[test]
fn a_format_takes_another_pattern() {
    let mut format = DateFormat::open(c"en", &units("y")).unwrap();
    format.set_pattern(&units("MMM d")).unwrap();
    let mut out = Buffer::new();
    format.format(&mut calendar_at(0.0), &mut out).unwrap();
    assert_eq!(text(&out), "Jan 1");
}

#[test]
fn text_ends_at_a_letter_that_is_no_field() {
    let format = DateFormat::open(c"en", &units("y T d")).unwrap();
    let mut out = Buffer::new();
    format.format(&mut calendar_at(0.0), &mut out).unwrap();
    assert!(text(&out).starts_with("1970 ") && !text(&out).ends_with('1'));
    let fields = format.format_fields(&mut calendar_at(0.0), &mut out);
    assert!(fields.is_err());
}

#[test]
fn ranges_have_spans_unless_both_ends_read_the_same() {
    let format = DateIntervalFormat::open(c"en", &units("yMMMd")).unwrap();
    let range = |start, end| {
        let result = format
            .format(&mut calendar_at(start), &mut calendar_at(end))
            .unwrap();
        let value = result.value().unwrap();
        let mut fields = value.fields_in(Category::DATE_INTERVAL_SPAN).unwrap();
        let mut spans = Vec::new();
        while let Some(span) = fields.next().unwrap() {
            spans.push((span.field, span.range));
        }
        (text(value.text().unwrap()), spans)
    };
    assert_eq!(
        range(0.0, 2.0 * DAY),
        (
            "Jan 1\u{2009}\u{2013}\u{2009}3, 1970".into(),
            vec![(0, 4..5), (1, 8..9)]
        )
    );
    assert_eq!(range(0.0, 1.0), ("Jan 1, 1970".into(), vec![]));
}
