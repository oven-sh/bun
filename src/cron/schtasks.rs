use core::fmt::Write as _;

use bun_core::strings;

use crate::expression::{ALL_DAYS, ALL_HOURS, values};
use crate::{CronExpression, Registration, XmlText};

#[derive(thiserror::Error, Debug, PartialEq, Eq)]
#[error(
    "This cron expression requires too many triggers for Windows Task Scheduler (max 48). Simplify the expression or use fewer restricted fields."
)]
pub struct TooManyTriggers;

pub fn task_xml(job: &Registration<'_>) -> Result<String, TooManyTriggers> {
    let (title, schedule) = (&job.title, &job.schedule);
    let (exe, script) = (XmlText(job.exe), XmlText(job.script));
    let triggers = triggers(schedule)?;
    Ok(format!(
        r#"<?xml version="1.0"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Triggers>
{triggers}  </Triggers>
<Principals>
<Principal>
<LogonType>S4U</LogonType>
<RunLevel>LeastPrivilege</RunLevel>
</Principal>
</Principals>
<Settings>
<Enabled>true</Enabled>
<AllowStartOnDemand>true</AllowStartOnDemand>
<AllowHardTerminate>true</AllowHardTerminate>
<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
<StartWhenAvailable>true</StartWhenAvailable>
</Settings>
<Actions>
<Exec>
<Command>{exe}</Command>
<Arguments>run --cron-title={title} --cron-period="{schedule}" "{script}"</Arguments>
</Exec>
</Actions>
</Task>
"#
    ))
}

/// What to reject with for the stderr of a `schtasks /create` that failed. Empty if it printed nothing.
pub fn explain_failure(stderr: &[u8]) -> &[u8] {
    if strings::contains(stderr, b"No mapping between account names") {
        return b"Failed to register cron job: your Windows account's Security Identifier (SID) could not be resolved. \
            This typically happens on headless servers or CI where the process runs under a service account. \
            To fix this, either run Bun as a regular user account, or create the scheduled task manually with: \
            schtasks /create /xml <file> /tn <name> /ru SYSTEM /f";
    }
    strings::trim(stderr, b" \t\n\r\x0b\x0c")
}

const EVERY_DAY: &str = "      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>\n";

fn triggers(schedule: &CronExpression) -> Result<String, TooManyTriggers> {
    let (minutes, hours) = (schedule.minutes, schedule.hours);
    let trigger = |hour: u32, minute: u32, days: &str| {
        format!(
            "    <CalendarTrigger>\n      <StartBoundary>2000-01-01T{hour:02}:{minute:02}:00</StartBoundary>\n{days}    </CalendarTrigger>\n"
        )
    };

    let days = days(schedule);
    if days == [EVERY_DAY]
        && let Some(interval) = repetition(minutes, hours)
    {
        let days =
            format!("      <Repetition><Interval>{interval}</Interval></Repetition>\n{EVERY_DAY}");
        return Ok(trigger(
            hours.trailing_zeros(),
            minutes.trailing_zeros(),
            &days,
        ));
    }

    if (minutes.count_ones() * hours.count_ones()) as usize * days.len() > 48 {
        return Err(TooManyTriggers);
    }
    let mut triggers = String::new();
    for hour in values(hours) {
        for minute in values(minutes) {
            for days in &days {
                triggers += &trigger(hour, minute, days);
            }
        }
    }
    Ok(triggers)
}

/// The interval of the one repeating trigger that fires at these times of every day.
fn repetition(minutes: u64, hours: u64) -> Option<String> {
    if hours == ALL_HOURS {
        return even_step(minutes, 60).map(|step| format!("PT{step}M"));
    }
    if minutes.count_ones() == 1 {
        return even_step(hours, 24).map(|step| format!("PT{step}H"));
    }
    None
}

/// The distance between the values of `set`, if it is always the same, across the end of `period` too.
fn even_step(set: u64, period: u32) -> Option<u32> {
    let (first, count) = (set.trailing_zeros(), set.count_ones());
    let step = period.checked_div(count)?;
    let steps = (0..count).map(|i| first + i * step);
    (step * count == period && values(set).eq(steps)).then_some(step)
}

/// The days part of each trigger that a time of day needs: cron fires when the day or the weekday matches.
fn days(schedule: &CronExpression) -> Vec<String> {
    const WEEKS: &str = "        <Weeks><Week>1</Week><Week>2</Week><Week>3</Week><Week>4</Week><Week>Last</Week></Weeks>\n";
    let [_, _, day, month, weekday] = schedule.restricted_fields();
    let months = named("Months", schedule.months >> 1, &MONTHS);
    let mut days = Vec::new();
    if day.is_some() || (weekday.is_none() && month.is_some()) {
        let mut listed = String::new();
        for day in values(day.unwrap_or(ALL_DAYS)) {
            _ = writeln!(listed, "          <Day>{day}</Day>");
        }
        days.push(format!(
            "      <ScheduleByMonth>\n        <DaysOfMonth>\n{listed}        </DaysOfMonth>\n{months}      </ScheduleByMonth>\n"
        ));
    }
    if let Some(weekday) = weekday {
        let weekdays = named("DaysOfWeek", weekday, &WEEKDAYS);
        days.push(match month {
            None => format!(
                "      <ScheduleByWeek>\n        <WeeksInterval>1</WeeksInterval>\n{weekdays}      </ScheduleByWeek>\n"
            ),
            Some(_) => format!(
                "      <ScheduleByMonthDayOfWeek>\n{WEEKS}{weekdays}{months}      </ScheduleByMonthDayOfWeek>\n"
            ),
        });
    }
    if days.is_empty() {
        days.push(EVERY_DAY.to_owned());
    }
    days
}

fn named(tag: &str, set: u64, names: &[&str]) -> String {
    let mut xml = format!("        <{tag}>\n");
    for (value, name) in names.iter().enumerate() {
        if set >> value & 1 != 0 {
            _ = writeln!(xml, "          <{name}/>");
        }
    }
    xml + &format!("        </{tag}>\n")
}

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

const WEEKDAYS: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];
