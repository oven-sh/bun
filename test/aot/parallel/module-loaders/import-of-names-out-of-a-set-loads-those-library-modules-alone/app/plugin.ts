export const name = "plugin";
export function run(input: string) { return "PLUGIN-RAN-" + input; }
export function spare(input: { deep: { deeper: number } }) { return "PLUGIN-SPARE-" + input.deep.deeper; }
