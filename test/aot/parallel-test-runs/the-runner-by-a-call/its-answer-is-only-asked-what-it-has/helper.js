export const spyWith = () => {
  console.log(typeof Bun.jest(import.meta.path).suite === "function", !Bun.jest(import.meta.path).spyOn, Bun.jest(import.meta.path).jest !== undefined);
};
