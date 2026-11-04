interface Inner12 { extra: number; quiet?: () => unknown }
interface Box12 { extra: number; name: string; inner: Inner12; failed?: { extra: number; message: string; name: string } }
export const box12: Box12 = { extra: 12, name: 'b12', inner: { extra: 12 } };
export function make12(extra: number): Box12 { return { extra, name: 'm', inner: { extra } }; }
