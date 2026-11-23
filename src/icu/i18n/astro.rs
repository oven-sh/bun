//! The sun and the moon. The order of operations decides on which day a month starts. ICU4C: astro.cpp

use crate::common::slice_ext::SliceExt;
use crate::i18n::gregoimp::{ONE_DAY, UDate};
use std::f64::consts::PI;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};

const PI2: f64 = PI * 2.0;

pub(crate) const SYNODIC_MONTH: f64 = 29.530588853;
const TROPICAL_YEAR: f64 = 365.242191;

const JULIAN_EPOCH_MS: f64 = -210866760000000.0;
const JD_EPOCH: f64 = 2447891.5; // Epoch of the orbital elements: 0 January 1990

const SUN_ETA_G: f64 = 279.403303 * PI / 180.0; // Ecliptic longitude at epoch
const SUN_OMEGA_G: f64 = 282.768422 * PI / 180.0; // Ecliptic longitude of perigee
const SUN_E: f64 = 0.016713; // Eccentricity of orbit

const MOON_L0: f64 = 318.351648 * PI / 180.0; // Mean longitude at epoch
const MOON_P0: f64 = 36.340410 * PI / 180.0; // Mean longitude of perigee
const MOON_N0: f64 = 318.510107 * PI / 180.0; // Mean longitude of node
const MOON_I: f64 = 5.145366 * PI / 180.0; // Inclination of orbit

fn norm_2pi(angle: f64) -> f64 {
    angle - PI2 * (angle / PI2).floor()
}

fn norm_pi(angle: f64) -> f64 {
    norm_2pi(angle + PI) - PI
}

fn days_since_epoch(time: UDate) -> f64 {
    (time - JULIAN_EPOCH_MS) / ONE_DAY - JD_EPOCH
}

/// Returns the sun's longitude and mean anomaly.
fn sun(day: f64) -> (f64, f64) {
    let mean_anomaly = norm_2pi(norm_2pi(PI2 / TROPICAL_YEAR * day) + SUN_ETA_G - SUN_OMEGA_G);
    // Kepler's equation.
    let mut e = mean_anomaly;
    let mut delta = f64::INFINITY;
    while delta.abs() > 1e-5 {
        delta = e - SUN_E * e.sin() - mean_anomaly;
        e -= delta / (1.0 - SUN_E * e.cos());
    }
    let true_anomaly = 2.0 * ((e / 2.0).tan() * ((1.0 + SUN_E) / (1.0 - SUN_E)).sqrt()).atan();
    (norm_2pi(true_anomaly + SUN_OMEGA_G), mean_anomaly)
}

/// Returns radians along the ecliptic from the vernal equinox.
pub(crate) fn sun_longitude(time: UDate) -> f64 {
    sun(days_since_epoch(time)).0
}

/// Returns the angle between the ecliptic longitudes of the moon and the sun.
pub(crate) fn moon_age(time: UDate) -> f64 {
    let day = days_since_epoch(time);
    let (sun_longitude, mean_anomaly_sun) = sun(day);
    let sin_sun = mean_anomaly_sun.sin();

    let mean_longitude = norm_2pi(13.1763966 * PI / 180.0 * day + MOON_L0);
    let mut mean_anomaly = norm_2pi(mean_longitude - 0.1114041 * PI / 180.0 * day - MOON_P0);
    let evection =
        1.2739 * PI / 180.0 * (2.0 * (mean_longitude - sun_longitude) - mean_anomaly).sin();
    let annual = 0.1858 * PI / 180.0 * sin_sun;
    let a3 = 0.3700 * PI / 180.0 * sin_sun;
    mean_anomaly += evection - annual - a3;

    let center = 6.2886 * PI / 180.0 * mean_anomaly.sin();
    let a4 = 0.2140 * PI / 180.0 * (2.0 * mean_anomaly).sin();
    let mut longitude = mean_longitude + evection + center - annual + a4;
    longitude += 0.6583 * PI / 180.0 * (2.0 * (longitude - sun_longitude)).sin();

    // From the plane of the moon's orbit to the ecliptic.
    let node = norm_2pi(MOON_N0 - 0.0529539 * PI / 180.0 * day) - 0.16 * PI / 180.0 * sin_sun;
    let (y, x) = ((longitude - node).sin(), (longitude - node).cos());
    norm_2pi((y * MOON_I.cos()).atan2(x) + node - sun_longitude)
}

pub(crate) fn next_winter_solstice(from: UDate) -> UDate {
    time_of_angle(sun_longitude, from, PI * 3.0 / 2.0, TROPICAL_YEAR, true)
}

/// Returns the time of the next or the previous new moon.
pub(crate) fn new_moon_time(from: UDate, next: bool) -> UDate {
    time_of_angle(moon_age, from, 0.0, SYNODIC_MONTH, next)
}

/// Returns the next or the previous time at which `angle_at` equals `desired`, accurate to a minute.
fn time_of_angle(
    angle_at: fn(UDate) -> f64,
    mut start: UDate,
    desired: f64,
    period_days: f64,
    next: bool,
) -> UDate {
    let period = period_days * ONE_DAY;
    'start: loop {
        let mut last_angle = angle_at(start);
        let mut delta =
            (norm_2pi(desired - last_angle) + if next { 0.0 } else { -PI2 }) * period / PI2;
        let mut time = start + delta.ceil();
        loop {
            let angle = angle_at(time);
            let correction = norm_pi(desired - angle) * (delta / norm_pi(angle - last_angle)).abs();
            if correction.abs() > delta.abs() {
                // The search diverges if it starts on the day of the new moon: restart an eighth of the period away.
                let step = (period / 8.0).ceil();
                start += if next { step } else { -step };
                continue 'start;
            }
            (delta, last_angle) = (correction, angle);
            time += delta.ceil();
            if delta.abs() > 60_000.0 {
                continue;
            }
            return time;
        }
    }
}

/// A direct-mapped cache of month and year starts. An entry holds key and value in one atomic.
pub(crate) struct CalendarCache([AtomicU64; SLOTS]);

const SLOTS: usize = 1024;

impl CalendarCache {
    pub(crate) const fn new() -> Self {
        Self([const { AtomicU64::new(0) }; SLOTS])
    }

    fn index(key: i32) -> usize {
        key as u32 as usize % SLOTS
    }

    /// The value 0 marks an empty slot.
    pub(crate) fn get(&self, key: i32) -> Option<i32> {
        let entry = self.0.soft_get(Self::index(key))?.load(Relaxed);
        ((entry >> 32) as i32 == key && entry as i32 != 0).then_some(entry as i32)
    }

    pub(crate) fn put(&self, key: i32, value: i32) {
        if let Some(slot) = self.0.soft_get(Self::index(key)) {
            slot.store(
                u64::from(key as u32) << 32 | u64::from(value as u32),
                Relaxed,
            );
        }
    }
}
