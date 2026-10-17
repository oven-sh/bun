function late(): { a: number } { return { a: below.a }; }
export const made = late();
const below = { a: 1 };
