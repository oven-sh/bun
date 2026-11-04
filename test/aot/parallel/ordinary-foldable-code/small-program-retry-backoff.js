const MAX_RETRIES = 5;
const BASE_DELAY = 100;
const FACTOR = 2;
const CAP = 1000;
const delays = Array.from({ length: MAX_RETRIES }, (_, i) => Math.min(CAP, BASE_DELAY * FACTOR ** i));
console.log(delays, delays.reduce((a, b) => a + b));
