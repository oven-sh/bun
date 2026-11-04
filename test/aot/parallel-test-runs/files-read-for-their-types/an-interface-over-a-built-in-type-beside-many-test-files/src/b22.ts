interface Inner22 { extra: number; quiet?: () => unknown }
interface Box22 { extra: number; name: string; inner: Inner22; failed?: { extra: number; message: string; name: string } }
export const box22: Box22 = { extra: 22, name: 'b22', inner: { extra: 22 } };
export function make22(extra: number): Box22 { return { extra, name: 'm', inner: { extra } }; }
