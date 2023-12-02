// source code
import { matchInFile } from "macro:matchInFile";

export const IPAddresses = () => (
  <div>
    <h2>recent ip addresses</h2>
    <div className="Lines">
      {matchInFile("access.log", /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}/).map((ipAddress, index) => (
        <div className="Line" key={index}>
          {ipAddress}
        </div>
      ))}
    </div>
  </div>
);
