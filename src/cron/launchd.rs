use core::fmt::Write as _;

use crate::expression::values;
use crate::{CronExpression, Registration, XmlText};

pub fn plist(job: &Registration<'_>) -> String {
    let (title, schedule) = (&job.title, &job.schedule);
    let (exe, script) = (XmlText(job.exe), XmlText(job.script));
    let interval = calendar_interval(schedule);
    format!(
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
<string>/tmp/bun.cron.{title}.stdout.log</string>
<key>StandardErrorPath</key>
<string>/tmp/bun.cron.{title}.stderr.log</string>
</dict>
</plist>
"#
    )
}

/// launchd fires when any dict matches, and a dict matches when all of its keys do.
fn calendar_interval(schedule: &CronExpression) -> String {
    let fields @ [minute, hour, day, month, weekday] = schedule.restricted_fields();
    let mut dicts = String::new();
    if day.is_some() && weekday.is_some() {
        // cron fires when either of the two matches.
        append_dicts(&mut dicts, "", &KEYS, &[minute, hour, day, month, None]);
        append_dicts(&mut dicts, "", &KEYS, &[minute, hour, None, month, weekday]);
    } else {
        append_dicts(&mut dicts, "", &KEYS, &fields);
        if fields.iter().flatten().all(|set| set.count_ones() == 1) {
            dicts.pop();
            return dicts;
        }
    }
    format!("    <array>\n{dicts}    </array>")
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
