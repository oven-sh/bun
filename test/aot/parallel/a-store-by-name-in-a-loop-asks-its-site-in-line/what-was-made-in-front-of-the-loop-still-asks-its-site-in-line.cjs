// The twin of the other side: made once in front of the loop, the store replaces a word every turn.
// STATISTIC: SiteCachedStoresEmittedInline >= 1
"use strict";
function counted(turns) { const grip = x => x + 1; grip.lid = 0; let sum = 0; for (let i = 0; i < turns; i++) { grip.lid = i; sum = (sum + grip.lid + grip(i)) | 0; } return sum + ":" + grip.lid + ":" + Object.keys(grip).join(); }
console.log(counted(6000));
