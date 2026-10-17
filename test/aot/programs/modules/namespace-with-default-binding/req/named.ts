const named = { name: "named", get hidden() { return false } } satisfies { name: string; hidden: boolean }
export default named
export const other = 2
