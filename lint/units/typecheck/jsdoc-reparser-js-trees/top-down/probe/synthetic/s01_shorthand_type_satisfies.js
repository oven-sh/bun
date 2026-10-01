const a = 1, b = 2;
const o = {
    /** @type {number} */
    a,
    /** @satisfies {number} */
    b = 3,
    /** @type {string} */
    c: "x",
    /** @satisfies {string} */
    d: "y",
};
