// Rest elements in last position. In an array pattern the rest element can be a pattern.
let [a, ...b] = [];
let { a, ...b } = {};
let [...[a, b]] = [];
let [...{ length }] = [];
