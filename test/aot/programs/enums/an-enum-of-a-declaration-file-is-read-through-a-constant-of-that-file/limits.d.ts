export declare enum Lower {
  Least = 1,
}
export declare enum Upper {
  Step = 4,
  Most = Upper.Step << 2,
}
export declare const least = Lower.Least;
export declare const most = Upper.Most;
