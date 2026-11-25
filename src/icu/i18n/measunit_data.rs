//! The tables of ICU4C: measunit.cpp, measunit_extra.cpp

use crate::common::packed_strs;

packed_strs! {
    /// Type and subtype of each built-in unit but the currencies.
    pub(crate) static BUILT_IN_KEYS = [
        "acceleration/g-force", "acceleration/meter-per-square-second", "angle/arc-minute", "angle/arc-second",
        "angle/degree", "angle/radian", "angle/revolution", "angle/steradian", "area/acre", "area/bu-jp",
        "area/cho", "area/dunam", "area/hectare", "area/se-jp", "area/square-centimeter", "area/square-foot",
        "area/square-inch", "area/square-kilometer", "area/square-meter", "area/square-mile",
        "area/square-yard", "concentr/item", "concentr/karat", "concentr/katal",
        "concentr/milligram-ofglucose-per-deciliter", "concentr/millimole-per-liter", "concentr/mole",
        "concentr/ofglucose", "concentr/part", "concentr/part-per-1e6", "concentr/part-per-1e9",
        "concentr/percent", "concentr/permille", "concentr/permyriad", "consumption/liter-per-100-kilometer",
        "consumption/liter-per-kilometer", "consumption/mile-per-gallon",
        "consumption/mile-per-gallon-imperial", "digital/bit", "digital/byte", "digital/gigabit",
        "digital/gigabyte", "digital/kilobit", "digital/kilobyte", "digital/megabit", "digital/megabyte",
        "digital/petabyte", "digital/terabit", "digital/terabyte", "duration/century", "duration/day",
        "duration/day-person", "duration/decade", "duration/fortnight", "duration/hour", "duration/microsecond",
        "duration/millisecond", "duration/minute", "duration/month", "duration/month-person",
        "duration/nanosecond", "duration/night", "duration/quarter", "duration/second", "duration/week",
        "duration/week-person", "duration/year", "duration/year-person", "electric/ampere", "electric/coulomb",
        "electric/farad", "electric/henry", "electric/milliampere", "electric/ohm", "electric/siemens",
        "electric/volt", "energy/becquerel", "energy/british-thermal-unit", "energy/british-thermal-unit-it",
        "energy/calorie", "energy/calorie-it", "energy/electronvolt", "energy/foodcalorie", "energy/gray",
        "energy/joule", "energy/kilocalorie", "energy/kilojoule", "energy/kilowatt-hour", "energy/sievert",
        "energy/therm-us", "force/dyne", "force/kilogram-force", "force/kilowatt-hour-per-100-kilometer",
        "force/newton", "force/pound-force", "force/poundal", "frequency/gigahertz", "frequency/hertz",
        "frequency/kilohertz", "frequency/megahertz", "graphics/dot", "graphics/dot-per-centimeter",
        "graphics/dot-per-inch", "graphics/em", "graphics/megapixel", "graphics/pixel",
        "graphics/pixel-per-centimeter", "graphics/pixel-per-inch", "length/astronomical-unit",
        "length/centimeter", "length/chain", "length/decimeter", "length/earth-radius", "length/fathom",
        "length/foot", "length/furlong", "length/inch", "length/jo-jp", "length/ken", "length/kilometer",
        "length/light-year", "length/meter", "length/micrometer", "length/mile", "length/mile-scandinavian",
        "length/milliinch", "length/millimeter", "length/nanometer", "length/nautical-mile", "length/parsec",
        "length/picometer", "length/point", "length/ri-jp", "length/rin", "length/rod", "length/shaku-cloth",
        "length/shaku-length", "length/solar-radius", "length/sun", "length/yard", "light/candela",
        "light/lumen", "light/lux", "light/solar-luminosity", "magnetic/tesla", "magnetic/weber", "mass/carat",
        "mass/dalton", "mass/earth-mass", "mass/fun", "mass/grain", "mass/gram", "mass/kilogram",
        "mass/microgram", "mass/milligram", "mass/ounce", "mass/ounce-troy", "mass/pound", "mass/slug",
        "mass/solar-mass", "mass/stone", "mass/ton", "mass/tonne", "power/gigawatt", "power/horsepower",
        "power/kilowatt", "power/megawatt", "power/milliwatt", "power/watt", "pressure/atmosphere",
        "pressure/bar", "pressure/gasoline-energy-density", "pressure/hectopascal", "pressure/inch-ofhg",
        "pressure/kilopascal", "pressure/megapascal", "pressure/millibar", "pressure/millimeter-ofhg",
        "pressure/ofhg", "pressure/pascal", "pressure/pound-force-per-square-inch", "speed/beaufort",
        "speed/kilometer-per-hour", "speed/knot", "speed/light-speed", "speed/meter-per-second",
        "speed/mile-per-hour", "temperature/celsius", "temperature/fahrenheit", "temperature/generic",
        "temperature/kelvin", "temperature/rankine", "torque/newton-meter", "torque/pound-force-foot",
        "volume/acre-foot", "volume/barrel", "volume/bushel", "volume/centiliter", "volume/cubic-centimeter",
        "volume/cubic-foot", "volume/cubic-inch", "volume/cubic-kilometer", "volume/cubic-meter",
        "volume/cubic-mile", "volume/cubic-yard", "volume/cup", "volume/cup-imperial", "volume/cup-jp",
        "volume/cup-metric", "volume/deciliter", "volume/dessert-spoon", "volume/dessert-spoon-imperial",
        "volume/dram", "volume/drop", "volume/fluid-ounce", "volume/fluid-ounce-imperial",
        "volume/fluid-ounce-metric", "volume/gallon", "volume/gallon-imperial", "volume/hectoliter",
        "volume/jigger", "volume/koku", "volume/kosaji", "volume/liter", "volume/megaliter",
        "volume/milliliter", "volume/osaji", "volume/pinch", "volume/pint", "volume/pint-imperial",
        "volume/pint-metric", "volume/quart", "volume/quart-imperial", "volume/sai", "volume/shaku",
        "volume/tablespoon", "volume/teaspoon", "volume/to-jp",
    ];
}

packed_strs! {
    pub(crate) static PREFIX_NAMES = [
        "quetta", "ronna", "yotta", "zetta", "exa", "peta", "tera", "giga", "mega", "kilo", "hecto", "deka", "deci",
        "centi", "milli", "micro", "nano", "pico", "femto", "atto", "zepto", "yocto", "ronto", "quecto", "yobi",
        "zebi", "exbi", "pebi", "tebi", "gibi", "mebi", "kibi",
    ];
}

/// The `UMeasurePrefix` of each of `PREFIX_NAMES`.
pub(crate) static PREFIXES: [i8; 32] = [
    60, 57, 54, 51, 48, 45, 42, 39, 36, 33, 32, 31, 29, 28, 27, 24, 21, 18, 15, 12, 9, 6, 3, 0,
    -52, -53, -54, -55, -56, -57, -58, -59,
];
