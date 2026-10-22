const date = new Date(0);
console.log(date.getTime(), date.getUTCFullYear());
date.setTime(86400000);
console.log(date.getTime(), date.getUTCDate());
date.setUTCFullYear(2000);
console.log(date.getUTCFullYear(), date.toISOString());
