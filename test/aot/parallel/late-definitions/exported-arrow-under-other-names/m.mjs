const arrow = x => x * 2;
const other = () => "other";
export { arrow as renamed, other };
export default arrow;
export const list = [arrow, other];
export const readArrow = () => arrow;
