const sequence = [1, 2, 3];
const reversedSequence = [...sequence].reverse();
sequence; // => [1, 2, 3]

const outOfOrder = new Uint8Array([3, 1, 2]);
const sortedOutOfOrder = Uint8Array.from([...outOfOrder].sort());
outOfOrder; // => Uint8Array [3, 1, 2]

const correctionNeeded = [1, 1, 3];
correctionNeeded.with(1, 2); // => [1, 2, 3]
correctionNeeded; // => [1, 1, 3]
