use core::fmt::Write as _;

use bstr::BStr;

use crate::expression::values;
use crate::{CronExpression, Registration, XmlText};

/// Bounds the size of the plist. Minute, hour and weekday alone need at most 59 * 23 * 6.
const MAX_INTERVALS: u32 = 10_000;

#[derive(thiserror::Error, Debug, PartialEq, Eq)]
#[error(
    "This cron expression requires too many calendar intervals for launchd (max {MAX_INTERVALS}). Simplify the expression or use fewer restricted fields."
)]
pub struct TooManyIntervals;

/// Where no other user can plant a link at the name of a log.
pub fn log_dir(home: &[u8]) -> String {
    format!("{}/Library/Logs/bun/cron", BStr::new(home))
}

pub fn plist(job: &Registration<'_>, home: &[u8]) -> Result<String, TooManyIntervals> {
    let (title, schedule) = (&job.title, &job.schedule);
    let (exe, script) = (XmlText(job.exe), XmlText(job.script));
    let interval = calendar_interval(schedule)?;
    let logs = log_dir(home);
    let logs = XmlText(logs.as_bytes());
    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>Label</key>
<string>bun.cron.{title}</string>
<key>ProgramArguments</key>
<array>
<string>{exe}</string>
<string>run</string>
<string>--cron-title={title}</string>
<string>--cron-period={schedule}</string>
<string>{script}</string>
</array>
<key>StartCalendarInterval</key>
{interval}
<key>StandardOutPath</key>
<string>{logs}/bun.cron.{title}.stdout.log</string>
<key>StandardErrorPath</key>
<string>{logs}/bun.cron.{title}.stderr.log</string>
</dict>
</plist>
"#
    ))
}

/// launchd fires when any dict matches, and a dict matches when all of its keys do.
fn calendar_interval(schedule: &CronExpression) -> Result<String, TooManyIntervals> {
    let fields @ [minute, hour, day, month, weekday] = schedule.restricted_fields();
    let products: &[_] = if day.is_some() && weekday.is_some() {
        // cron fires when either of the two matches.
        &[
            [minute, hour, day, month, None],
            [minute, hour, None, month, weekday],
        ]
    } else {
        &[fields]
    };
    let count: u32 = (products.iter())
        .map(|fields| fields.iter().flatten().map(|set| set.count_ones()))
        .map(Iterator::product::<u32>)
        .sum();
    if count > MAX_INTERVALS {
        return Err(TooManyIntervals);
    }
    let mut dicts = String::new();
    for fields in products {
        append_dicts(&mut dicts, "", &KEYS, fields);
    }
    if count == 1 {
        dicts.pop();
        return Ok(dicts);
    }
    Ok(format!("    <array>\n{dicts}    </array>"))
}

const KEYS: [&str; 5] = ["Minute", "Hour", "Day", "Month", "Weekday"];

/// A dict for each combination of the values of `fields`, which `keys` names, after `written`.
fn append_dicts(dicts: &mut String, written: &str, keys: &[&str], fields: &[Option<u64>]) {
    match (keys, fields) {
        ([_, keys @ ..], [None, fields @ ..]) => append_dicts(dicts, written, keys, fields),
        ([key, keys @ ..], [Some(set), fields @ ..]) => {
            for value in values(*set) {
                let written = format!(
                    "{written}        <key>{key}</key>\n        <integer>{value}</integer>\n"
                );
                append_dicts(dicts, &written, keys, fields);
            }
        }
        _ => _ = write!(dicts, "    <dict>\n{written}    </dict>\n"),
    }
}
