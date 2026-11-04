interface Inner9 { extra: number; quiet?: () => unknown }
interface Box9 { extra: number; name: string; inner: Inner9; failed?: { extra: number; message: string; name: string } }
export const box9: Box9 = { extra: 9, name: 'b9', inner: { extra: 9 } };
export function make9(extra: number): Box9 { return { extra, name: 'm', inner: { extra } }; }
