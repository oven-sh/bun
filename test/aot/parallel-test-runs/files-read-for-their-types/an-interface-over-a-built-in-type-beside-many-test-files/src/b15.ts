interface Inner15 { extra: number; quiet?: () => unknown }
interface Box15 { extra: number; name: string; inner: Inner15; failed?: { extra: number; message: string; name: string } }
export const box15: Box15 = { extra: 15, name: 'b15', inner: { extra: 15 } };
export function make15(extra: number): Box15 { return { extra, name: 'm', inner: { extra } }; }
