// An array of one element never leaves its function. A loop stores a new object into the element, the element is read, and a second loop stores another new object or array into it.
(function sameLayoutTwice() {
    const holder = [null];
    for (let i = 0; i < 400; ++i)
        holder[0] = { first: i };
    console.log("the same layout twice:", holder[0].first);
    for (let i = 0; i < 40; ++i)
        holder[0] = { first: i };
    console.log(holder[0].first);
})();

(function thenAnArrayLiteral() {
    const holder = [null];
    for (let i = 0; i < 400; ++i)
        holder[0] = { first: i };
    console.log("then an array literal:", holder[0].first);
    for (let i = 0; i < 40; ++i)
        holder[0] = [i];
    console.log(holder[0][0]);
})();

(function thenAnArrayOfALength() {
    const holder = [null];
    for (let i = 0; i < 400; ++i)
        holder[0] = { first: i };
    console.log("then an array of a length:", holder[0].first);
    for (let i = 0; i < 40; ++i)
        holder[0] = new Array(9);
    console.log(holder[0].length);
})();

(function thenAnArrayThatIsFilled() {
    const holder = [null];
    for (let i = 0; i < 400; ++i)
        holder[0] = { first: i };
    console.log("then an array that is filled:", holder[0].first);
    for (let i = 0; i < 40; ++i) {
        const array = new Array(9);
        array.fill(i);
        holder[0] = array;
    }
    console.log(holder[0][8]);
})();

(function thenAnotherLayout() {
    const holder = [null];
    for (let i = 0; i < 400; ++i)
        holder[0] = { first: i };
    console.log("then another layout:", holder[0].first);
    for (let i = 0; i < 40; ++i)
        holder[0] = { other: i };
    console.log(holder[0].other);
})();

(function withoutAReadBetween() {
    const holder = [null];
    for (let i = 0; i < 400; ++i)
        holder[0] = { first: i };
    for (let i = 0; i < 40; ++i)
        holder[0] = new Array(9);
    console.log("without a read between:", holder[0].length);
})();

(function theFirstStoreOutsideALoop() {
    const holder = [null];
    holder[0] = { first: 1 };
    console.log("the first store outside a loop:", holder[0].first);
    for (let i = 0; i < 40; ++i)
        holder[0] = new Array(9);
    console.log(holder[0].length);
})();

(function theSecondStoreOutsideALoop() {
    const holder = [null];
    for (let i = 0; i < 400; ++i)
        holder[0] = { first: i };
    console.log("the second store outside a loop:", holder[0].first);
    holder[0] = new Array(9);
    console.log(holder[0].length);
})();

(function thenAStringThatItsLoopReads() {
    const holder = [null];
    for (let i = 0; i < 400; ++i)
        holder[0] = { first: i };
    console.log("then a string that its loop reads:", holder[0].first);
    let characters = 0;
    for (let i = 0; i < 40; ++i) {
        holder[0] = ("x" + i).repeat(20);
        characters += holder[0].charCodeAt(0);
    }
    console.log(characters);
})();
