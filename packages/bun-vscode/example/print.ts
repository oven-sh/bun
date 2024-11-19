function getOldestPersonInBooking(ages: number[]): number {
  return ages.reduce((oldest, current) => 
    current > oldest ? current : oldest, 
    ages[0]
  );
}

const ticketAges = [5, 25, 30];
console.log(getOldestPersonInBooking(ticketAges));
