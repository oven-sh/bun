function whole(): string { return "what require yields"; }
whole.extra = "extra";
export { whole as "module.exports" };
export const beside: string = ["beside"].join();
