globalThis.__calledByAFreeName = value => "called with " + value;
console.log(__calledByAFreeName(1), typeof __calledByAFreeName);
