const subject = performance;
subject.onresourcetimingbufferfull = 1.5;
console.log(subject.onresourcetimingbufferfull === null);
