interface Inner14 { extra: number; quiet?: () => unknown }
interface Box14 { extra: number; name: string; inner: Inner14; failed?: { extra: number; message: string; name: string } }
export const box14: Box14 = { extra: 14, name: 'b14', inner: { extra: 14 } };
export function make14(extra: number): Box14 { return { extra, name: 'm', inner: { extra } }; }
