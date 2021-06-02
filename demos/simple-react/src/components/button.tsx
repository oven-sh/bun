export const Button = ({ label, onClick }) => (
  <div className="Button" onClick={onClick}>
    <div className="Button-label">{label}</div>
  </div>
);
