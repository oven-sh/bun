interface Inner11 { extra: number; quiet?: () => unknown }
interface Box11 { extra: number; name: string; inner: Inner11; failed?: { extra: number; message: string; name: string } }
export const box11: Box11 = { extra: 11, name: 'b11', inner: { extra: 11 } };
export function make11(extra: number): Box11 { return { extra, name: 'm', inner: { extra } }; }
