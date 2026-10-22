const date = new Date("nonsense");
console.log(date.getTime(), date.getFullYear(), date.getDay(), date.toJSON() === null, String(date));
