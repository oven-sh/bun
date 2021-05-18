label_name: {
  break label_name;
}

while_label: while (true) {
  for_label: for (let i = 0; i < 100; i++) {
    continue while_label;
  }
}
