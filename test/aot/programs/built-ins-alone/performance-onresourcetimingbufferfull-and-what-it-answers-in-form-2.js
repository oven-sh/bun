const subject = performance;
subject.onresourcetimingbufferfull = "an";
console.log(subject.onresourcetimingbufferfull === null);
