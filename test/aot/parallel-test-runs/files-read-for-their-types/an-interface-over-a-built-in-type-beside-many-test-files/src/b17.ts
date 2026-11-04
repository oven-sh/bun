interface Inner17 { extra: number; quiet?: () => unknown }
interface Box17 { extra: number; name: string; inner: Inner17; failed?: { extra: number; message: string; name: string } }
export const box17: Box17 = { extra: 17, name: 'b17', inner: { extra: 17 } };
export function make17(extra: number): Box17 { return { extra, name: 'm', inner: { extra } }; }
