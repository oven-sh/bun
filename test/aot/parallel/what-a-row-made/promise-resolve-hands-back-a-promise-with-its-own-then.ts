const own: any = Promise.resolve(1); own.then = () => "own then";
function asked(x: any): unknown { const made = Promise.resolve(x); return typeof made.then(() => 2) + " " + (made === x); }
console.log(asked(own), asked(1), asked(Promise.resolve(3)));
