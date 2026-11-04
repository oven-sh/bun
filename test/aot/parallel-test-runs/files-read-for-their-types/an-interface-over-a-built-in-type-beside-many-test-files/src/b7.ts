interface Inner7 { extra: number; quiet?: () => unknown }
interface Box7 { extra: number; name: string; inner: Inner7; failed?: { extra: number; message: string; name: string } }
export const box7: Box7 = { extra: 7, name: 'b7', inner: { extra: 7 } };
export function make7(extra: number): Box7 { return { extra, name: 'm', inner: { extra } }; }
