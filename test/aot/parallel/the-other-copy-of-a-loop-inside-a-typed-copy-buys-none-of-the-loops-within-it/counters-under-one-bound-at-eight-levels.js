// STATISTIC: WalkLoopsVersioned <= 60
// Each level asked the one bound anew, in both copies of the level around: 127 loops built twice.
function deep(bound) {
  let sum = 0;
for (let i0 = 0; i0 < bound; i0++) { sum += i0;
for (let i1 = 0; i1 < bound; i1++) { sum += i1;
for (let i2 = 0; i2 < bound; i2++) { sum += i2;
for (let i3 = 0; i3 < bound; i3++) { sum += i3;
for (let i4 = 0; i4 < bound; i4++) { sum += i4;
for (let i5 = 0; i5 < bound; i5++) { sum += i5;
for (let i6 = 0; i6 < bound; i6++) { sum += i6;
for (let i7 = 0; i7 < bound; i7++) { sum += i7;
}
}
}
}
}
}
}
}
  return sum;
}
console.log(deep(JSON.parse("2")));
