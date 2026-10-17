export let hits = 0
export let label = "none"
export const limit = 2 ** 31
export let late: number | undefined
export function bump(): void { hits += 70000; label = label + hits; late = hits / 4 }
export function read(): number { return hits + 0.5 }
export function state(): string { return typeof late + " " + late }
