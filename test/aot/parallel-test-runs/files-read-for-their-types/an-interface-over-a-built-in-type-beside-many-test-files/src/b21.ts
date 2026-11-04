interface Inner21 { extra: number; quiet?: () => unknown }
interface Box21 { extra: number; name: string; inner: Inner21; failed?: { extra: number; message: string; name: string } }
export const box21: Box21 = { extra: 21, name: 'b21', inner: { extra: 21 } };
export function make21(extra: number): Box21 { return { extra, name: 'm', inner: { extra } }; }
