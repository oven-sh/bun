interface Inner1 { extra: number; quiet?: () => unknown }
interface Box1 { extra: number; name: string; inner: Inner1; failed?: { extra: number; message: string; name: string } }
export const box1: Box1 = { extra: 1, name: 'b1', inner: { extra: 1 } };
export function make1(extra: number): Box1 { return { extra, name: 'm', inner: { extra } }; }
