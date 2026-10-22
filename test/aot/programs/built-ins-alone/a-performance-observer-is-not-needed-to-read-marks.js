performance.mark("here", { detail: { size: 1.5 } });
const marks = performance.getEntriesByName("here");
console.log(marks.length, marks[0].name, marks[0].detail.size + 1, typeof marks[0].startTime);
