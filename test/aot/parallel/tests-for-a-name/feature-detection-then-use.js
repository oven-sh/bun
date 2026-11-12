const word = JSON.parse('"semver"');
if (word in Bun) console.log(typeof Bun[word].satisfies); else console.log("none");
console.log("end");
