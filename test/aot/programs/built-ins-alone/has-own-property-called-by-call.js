const record = { present: 1 };
console.log(Object.prototype.hasOwnProperty.call(record, "present"), Object.prototype.hasOwnProperty.call(record, "absent"));
