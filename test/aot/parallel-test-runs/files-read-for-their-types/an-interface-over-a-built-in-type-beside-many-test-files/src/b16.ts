interface Inner16 { extra: number; quiet?: () => unknown }
interface Box16 { extra: number; name: string; inner: Inner16; failed?: { extra: number; message: string; name: string } }
export const box16: Box16 = { extra: 16, name: 'b16', inner: { extra: 16 } };
export function make16(extra: number): Box16 { return { extra, name: 'm', inner: { extra } }; }
