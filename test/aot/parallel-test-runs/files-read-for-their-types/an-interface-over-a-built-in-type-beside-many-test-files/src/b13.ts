interface Inner13 { extra: number; quiet?: () => unknown }
interface Box13 { extra: number; name: string; inner: Inner13; failed?: { extra: number; message: string; name: string } }
export const box13: Box13 = { extra: 13, name: 'b13', inner: { extra: 13 } };
export function make13(extra: number): Box13 { return { extra, name: 'm', inner: { extra } }; }
