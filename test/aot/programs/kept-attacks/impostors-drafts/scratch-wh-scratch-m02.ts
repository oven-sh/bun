// Impostors drafts: scratch wh scratch. It prints what plain Bun prints.
const text: string = "abc";
const index: number = -1;
try {
  console.log(text[index].toUpperCase());
} catch (error) {
  console.log(error instanceof TypeError);
}
export {};
